'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canonicalInstagramHandle,
  extractInstagramProfileCandidates,
  browserSearchUrl,
  loadSeedPage,
  runInstagramHeadlessDiscovery,
} = require('../lib/tasks/instagram-headless-discovery');

function fakeRepository(saved, jobs) {
  return {
    async createScrapeJob(job) { jobs.push(job); return 'job-1'; },
    async upsertCreators(rows) { saved.push(...rows); return { inserted: rows.length, updated: 0 }; },
    async finishScrapeJob() {},
  };
}

test('headless candidate extraction accepts only profile routes and deduplicates them', () => {
  assert.equal(canonicalInstagramHandle('/beauty.creator/'), 'beauty.creator');
  assert.equal(canonicalInstagramHandle('/explore/tags/beauty/'), '');
  assert.deepEqual(extractInstagramProfileCandidates(['/beauty.creator/', '/beauty.creator/?x=1', 'https://www.instagram.com/home.notes/', '/p/post/']), [
    { handle: 'beauty.creator', profileUrl: 'https://www.instagram.com/beauty.creator/' },
    { handle: 'home.notes', profileUrl: 'https://www.instagram.com/home.notes/' },
  ]);
  assert.match(browserSearchUrl('pet supplies'), /pet%20supplies/);
});

test('headless discovery stores candidate rows and never opens candidate profiles', async () => {
  const saved = [];
  const jobs = [];
  const calls = [];
  const page = {
    async setCookie(...cookies) { calls.push({ type: 'cookies', count: cookies.length }); },
    async goto(url) { calls.push({ type: 'goto', url }); return { status: () => 200 }; },
    async $$eval(selector) { calls.push({ type: 'links', selector }); return ['/beauty.creator/', '/home.notes/', '/explore/tags/beauty/']; },
    url() { return 'https://www.instagram.com/explore/search/keyword/?q=%23beauty'; },
  };
  const browser = { async newPage() { return page; }, async close() { calls.push({ type: 'close' }); } };
  const result = await runInstagramHeadlessDiscovery({
    databaseManager: { async getRepository() { return fakeRepository(saved, jobs); } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    seeds: [{ keyword: 'beauty', category: 'Beauty & Personal Care' }],
    createBrowser: async () => browser,
    waitFor: async () => {},
    pageSettleMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.creators, 2);
  assert.deepEqual(result.discovery, { seeds: 1, candidateLinks: 2, uniqueCandidates: 2, duplicateCandidates: 0, knownCandidates: 0, emptySeeds: 0 });
  assert.equal(jobs[0].collection, 'browser-search');
  assert.equal(saved[0].verificationStatus, 'pending_profile_check');
  assert.equal(saved[0].collection_mode, 'candidate_discovery');
  assert.equal(saved[0].category_provenance, 'keyword_category');
  assert.deepEqual(calls.filter(call => call.type === 'goto').map(call => call.url), ['https://www.instagram.com/explore/tags/beauty/']);
  assert.equal(calls.some(call => call.type === 'close'), true);
});

test('headless discovery speed metrics count only unique persisted candidates', async () => {
  const saved = [];
  const jobs = [];
  let now = 0;
  const page = {
    async setCookie() {},
    async goto() { return { status: () => 200 }; },
    async $$eval() { return ['/beauty.creator/']; },
    url() { return 'https://www.instagram.com/explore/tags/test/'; },
  };
  const browser = { async newPage() { return page; }, async close() {} };
  const result = await runInstagramHeadlessDiscovery({
    databaseManager: { async getRepository() { return fakeRepository(saved, jobs); } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    seeds: [{ keyword: 'beauty', category: 'Beauty' }, { keyword: 'fashion', category: 'Fashion' }],
    createBrowser: async () => browser, waitFor: async () => { now += 1_000; }, now: () => now, seedGapMs: 5_000, pageSettleMs: 0,
  });
  assert.equal(result.creators, 1);
  assert.equal(result.metrics.saved, 1);
  assert.deepEqual(result.discovery, { seeds: 2, candidateLinks: 2, uniqueCandidates: 1, duplicateCandidates: 1, knownCandidates: 0, emptySeeds: 0 });
});

test('headless discovery skips creators already in the platform library', async () => {
  const saved = [];
  const jobs = [];
  const page = {
    async setCookie() {},
    async goto() { return { status: () => 200 }; },
    async $$eval() { return ['/known.creator/', '/new.creator/']; },
    url() { return 'https://www.instagram.com/explore/tags/test/'; },
  };
  const repository = {
    ...fakeRepository(saved, jobs),
    async getCreatorIds() { return ['instagram:known.creator']; },
  };
  const browser = { async newPage() { return page; }, async close() {} };
  const result = await runInstagramHeadlessDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    seeds: [{ keyword: 'test', category: 'Technology' }],
    createBrowser: async () => browser,
    waitFor: async () => {},
    pageSettleMs: 0,
  });
  assert.equal(result.database.inserted, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(result.discovery, { seeds: 1, candidateLinks: 2, uniqueCandidates: 1, duplicateCandidates: 0, knownCandidates: 1, emptySeeds: 0 });
});

test('headless discovery stops on a browser 429 without profile traversal', async () => {
  const repository = fakeRepository([], []);
  const calls = [];
  const browser = {
    async newPage() {
      return {
        async setCookie() {},
        async goto() { calls.push('goto'); return { status: () => 429 }; },
        async $$eval() { calls.push('links'); return []; },
      };
    },
    async close() { calls.push('close'); },
  };
  await assert.rejects(() => runInstagramHeadlessDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    seeds: [{ keyword: 'beauty', category: 'Beauty & Personal Care' }],
    createBrowser: async () => browser,
  }), error => error.code === 'THROTTLED');
  assert.deepEqual(calls, ['goto', 'close']);
});

test('a login or challenge page is diagnosed as session attention without retrying', async () => {
  const calls = [];
  const browser = {
    async newPage() {
      return {
        async setCookie() {},
        async goto() { calls.push('goto'); return { status: () => 200 }; },
        url() { return 'https://www.instagram.com/challenge/'; },
      };
    },
    async close() { calls.push('close'); },
  };
  await assert.rejects(() => runInstagramHeadlessDiscovery({
    databaseManager: { async getRepository() { return fakeRepository([], []); } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    seeds: [{ keyword: 'beauty', category: 'Beauty' }], createBrowser: async () => browser,
  }), error => error.code === 'INSTAGRAM_SESSION_ATTENTION_REQUIRED');
  assert.deepEqual(calls, ['goto', 'close']);
});

test('transient browser navigation retries with a bounded delay but never retries a throttle', async () => {
  const calls = [];
  let attempts = 0;
  const page = {
    async goto() {
      attempts += 1;
      return { status: () => attempts === 1 ? 503 : 200 };
    },
  };
  const response = await loadSeedPage({
    page, keyword: 'beauty', retryDelaysMs: [1_000],
    onProgress: event => calls.push(event), waitFor: async delay => calls.push({ waited: delay }),
  });
  assert.equal(response.status(), 200);
  assert.equal(attempts, 2);
  assert.deepEqual(calls, [{ state: 'recovering', phase: 'browser_navigation_retry', keyword: 'beauty', retryAttempt: 1, retryDelayMs: 1_000 }, { waited: 1_000 }]);
});
