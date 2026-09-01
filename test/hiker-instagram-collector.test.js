'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hikerGetProfile, normalizeHikerProfile, runHikerInstagramProfileEnrichment } = require('../lib/tasks/hiker-instagram-collector');

test('Hiker normalizer keeps only public profile fields and public email provenance', () => {
  const item = normalizeHikerProfile({ pk: '42', username: 'creator.demo', full_name: 'Creator Demo', follower_count: 1200, public_email: 'hello@example.test', category_name: 'Beauty' }, 'ignored');
  assert.equal(item.nativeId, '42');
  assert.equal(item.handle, '@creator.demo');
  assert.equal(item.contact.email, 'hello@example.test');
  assert.equal(item.source, 'hiker-api:public-profile');
});

test('Hiker request never exposes API key and maps throttling safely', async () => {
  await assert.rejects(() => hikerGetProfile({ apiKey: 'secret-key', handle: 'creator.demo', fetchImpl: async () => ({ ok: false, status: 429 }) }), error => {
    assert.equal(error.code, 'HIKER_THROTTLED');
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
});

test('Hiker enrichment persists each profile and reports safe live progress', async () => {
  const persisted = [];
  const jobs = [];
  const progress = [];
  const repository = {
    createScrapeJob: async config => { jobs.push(config); return 7; },
    upsertCreators: async rows => { persisted.push(rows[0]); return { inserted: 1, updated: 0 }; },
    finishScrapeJob: async () => {},
  };
  const result = await runHikerInstagramProfileEnrichment({
    apiKey: 'never-log', handles: ['first.demo', 'second.demo'], databaseManager: { getRepository: async () => repository },
    fetchImpl: async url => ({ ok: true, status: 200, json: async () => ({ pk: url.includes('first') ? '1' : '2', username: url.includes('first') ? 'first.demo' : 'second.demo' }) }),
    onProgress: entry => progress.push(entry),
  });
  assert.equal(result.database.saved, 2);
  assert.equal(persisted.length, 2);
  assert.equal(progress.at(-1).completed, 2);
  assert.doesNotMatch(JSON.stringify({ jobs, progress }), /never-log/);
});
