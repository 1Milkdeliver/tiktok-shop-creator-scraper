'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { CreatorDatabase } = require('../lib/database');
const { exportCsv } = require('../lib/exporter');

test('WhatsApp and email filter viewing/export, but never gate contact enrichment', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-contact-filters-'));
  const db = new CreatorDatabase(path.join(dir, 'test.db'));
  t.after(() => db.close());
  await db.open();
  // Synthetic records only; never touch or delete the user's library.
  const row = (id, extra = {}) => ({ creator_oecuid: id, handle: `fixture-${id}`, follower_cnt: 1000, ...extra });
  await db.upsertCreators([
    row('both', { '合作邮箱': 'both@example.test', whatsapp: '001234' }),
    row('email', { '合作邮箱': 'email@example.test' }),
    row('whatsapp', { whatsapp: '009876' }),
    row('none'), row('line', { line: 'line-only' }),
    row('country', { whatsapp_country_code: '60' }),
    row('blank', { whatsapp: ' \t\r\n ' }), row('null', { whatsapp: null }),
    row('numeric', { whatsapp: 12345 }), row('empty', { whatsapp: '' }),
  ], { region: 'MY' });
  await db.upsertCreators([row('other-market', { whatsapp: '004444' })], { region: 'TH' });
  const ids = rows => rows.map(r => r.creator_id).sort();
  const filters = { hasWhatsapp: true, region: 'MY' };
  const wa = await db.listCreators(filters);
  assert.equal(wa.total, 2);
  assert.deepEqual(ids(wa.rows), ['both', 'whatsapp']);
  const both = await db.listCreators({ ...filters, hasEmail: true });
  assert.equal(both.total, 1);
  assert.deepEqual(ids(both.rows), ['both']);
  assert.equal((await db.listCreators({ region: 'MY', hasEmail: true })).total, 2);
  assert.equal((await db.listCreators({ region: 'MY', hasWhatsapp: false })).total, 10);
  const page = await db.listCreators({ ...filters, limit: 1, offset: 1 });
  assert.equal(page.total, 2); assert.equal(page.rows.length, 1);
  assert.deepEqual((await db.listCreatorIds(filters)).sort(), ids(wa.rows));
  assert.deepEqual(await db.listCreatorIds({ ...filters, hasEmail: true }), ['both']);
  const allMy = await db.listCreatorIds({region:'MY'});
  assert.deepEqual((await db.contactTargets(filters, 'MY', false)).sort(), allMy.sort());
  assert.deepEqual((await db.contactTargets({ ...filters, hasEmail: true }, 'MY', false)).sort(), allMy);
  assert.deepEqual(await db.contactTargets(filters, 'TH', false), []);
  assert.deepEqual(await db.listCreatorIds({ ...filters, minFollowers: 2000 }), []);
  assert.equal((await db.listCreators({ ...filters, search: 'missing-fixture' })).total, 0);
  const file = path.join(dir, 'filtered.csv');
  await exportCsv(file, both.rows, ['creator_id', 'whatsapp']);
  const csv = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  assert.equal(csv.length, 2);
  assert.match(csv[1], /both,001234/);
  assert.equal((await db.listCreators({})).total, 11);
});

test('actual drawer bulk actions preserve the fixed column and update every table cell', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('function setAllCreatorColumns(visible) {');
  const end = html.indexOf("document.getElementById('creatorColumnsAll').onclick", start);
  assert.ok(start > 0 && end > start);
  const fields = [{ k: 'handle' }, { k: 'nickname' }, { k: 'avatar' }, { k: 'whatsapp' }, { k: 'line' }];
  const cells = [...fields, { k: 'last_refreshed_at' }].filter(f => f.k !== 'avatar')
    .flatMap(f => [{ dataset: { field: f.k }, hidden: false }, { dataset: { field: f.k }, hidden: false }]);
  const context = {
    FIELDS: fields, LIBRARY_SKIP: new Set(['avatar']), hiddenCreatorColumns: new Set(['nickname']),
    renderCreatorColumns() {}, renderCreatorHead() {},
    document: { querySelectorAll(selector) { assert.equal(selector, '.creator-table [data-field]'); return cells; } },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  context.setAllCreatorColumns(false);
  assert.deepEqual([...context.hiddenCreatorColumns].sort(), ['last_refreshed_at', 'line', 'nickname', 'whatsapp']);
  assert.ok(cells.every(c => c.hidden === (c.dataset.field !== 'handle')));
  context.setAllCreatorColumns(false);
  assert.equal(context.hiddenCreatorColumns.size, 4);
  context.setAllCreatorColumns(true);
  assert.equal(context.hiddenCreatorColumns.size, 0);
  assert.ok(cells.every(c => !c.hidden));
});
