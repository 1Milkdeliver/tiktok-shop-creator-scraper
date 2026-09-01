'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canonicalInstagramHandle,
  unwrapBingUrl,
  extractInstagramCandidates,
  searchPageDiagnostics,
  bingSearchUrl,
  runInstagramPublicDiscovery,
} = require('../lib/tasks/instagram-public-discovery');

test('public discovery only accepts canonical Instagram profile URLs', () => {
  assert.equal(canonicalInstagramHandle('https://www.instagram.com/Beauty.Creator/?utm=x'), 'beauty.creator');
  assert.equal(canonicalInstagramHandle('https://www.instagram.com/explore/'), '');
  assert.equal(canonicalInstagramHandle('https://business.instagram.com/success/example/'), '');
  assert.deepEqual(extractInstagramCandidates([
    '<a href="https://www.instagram.com/beauty.creator/">one</a>',
    '<a href="https://www.instagram.com/beauty.creator/">duplicate</a>',
    '<a href="https://www.instagram.com/home.with.jane/?source=x">two</a>',
  ].join('')), [
    { handle: 'beauty.creator', sourceUrl: 'https://www.instagram.com/beauty.creator/', profileUrl: 'https://www.instagram.com/beauty.creator/' },
    { handle: 'home.with.jane', sourceUrl: 'https://www.instagram.com/home.with.jane/?source=x', profileUrl: 'https://www.instagram.com/home.with.jane/' },
  ]);
});

test('public discovery requests a stable English-market result page', () => {
  const url = new URL(bingSearchUrl('beauty'));
  assert.equal(url.searchParams.get('cc'), 'us');
  assert.equal(url.searchParams.get('setmkt'), 'en-US');
  assert.match(url.searchParams.get('q'), /-site:business\.instagram\.com/);
  assert.match(url.searchParams.get('q'), /-site:help\.instagram\.com/);
});

test('public discovery unwraps Bing result links before applying the profile filter', () => {
  const target = 'https://www.instagram.com/beauty.creator/';
  const wrapped = `https://www.bing.com/ck/a?u=a1${Buffer.from(target).toString('base64url')}`;
  assert.equal(unwrapBingUrl(wrapped), target);
  assert.deepEqual(extractInstagramCandidates(`<li class="b_algo"><h2><a href="${wrapped.replace(/&/g, '&amp;')}">profile</a></h2></li>`), [
    { handle: 'beauty.creator', sourceUrl: target, profileUrl: target },
  ]);
});

test('public discovery accepts JSON-escaped links and reordered Bing attributes', () => {
  const result = extractInstagramCandidates('<li id="b1" class="x b_algo"><h2><a data-x="1" href="https:\\/\\/www.instagram.com\\/creator_name\\/">Creator</a></h2></li>');
  assert.deepEqual(result.map(item => item.handle), ['creator_name']);
});

test('public discovery diagnostics retain only aggregate result-page evidence', () => {
  const diagnostics = searchPageDiagnostics('<li class="b_algo"><a href="https://www.instagram.com/creator/">x</a></li>', [{ handle: 'creator' }]);
  assert.deepEqual(diagnostics, { htmlBytes: 74, directProfileLinks: 1, resultBlocks: 1, candidateCount: 1, possibleVerificationPage: false });
});

test('public discovery persists candidates without a local session or profile claims', async () => {
  const saved = [];
  const jobs = [];
  const repository = {
    async createScrapeJob(job) { jobs.push(job); return 'job-1'; },
    async upsertCreators(rows) { saved.push(...rows); return { inserted: rows.length, updated: 0 }; },
    async finishScrapeJob() {},
  };
  const result = await runInstagramPublicDiscovery({
    databaseManager: { async getRepository(platform) { assert.equal(platform, 'instagram'); return repository; } },
    seeds: [{ keyword: 'beauty', category: 'Beauty & Personal Care' }],
    fetchImpl: async () => ({ ok: true, text: async () => '<a href="https://www.instagram.com/beauty.creator/">profile</a>' }),
    seedGapMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.creators, 1);
  assert.equal(jobs[0].collection, 'public-search');
  assert.equal(saved[0].handle, 'beauty.creator');
  assert.equal(saved[0].follower_cnt, null);
  assert.equal(saved[0].合作邮箱, '');
  assert.equal(saved[0].collection_mode, 'public_discovery');
  assert.equal(saved[0].discovery_source, 'search_engine_public_result');
  assert.equal(result.metrics.successRate, 1);
  assert.equal(result.metrics.saved, 1);
});

test('a completed public search with no candidates is successful but reports zero saved', async () => {
  const repository = {
    async createScrapeJob() { return 'job-1'; }, async upsertCreators() { return { inserted: 0, updated: 0 }; }, async finishScrapeJob() {},
  };
  const result = await runInstagramPublicDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    seeds: [{ keyword: 'beauty', category: 'Beauty & Personal Care' }],
    fetchImpl: async () => ({ ok: true, text: async () => '<html><body>no profile match</body></html>' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.creators, 0);
  assert.equal(result.metrics.successRate, 1);
  assert.equal(result.metrics.saved, 0);
});

test('public discovery surfaces 429 as its own stop condition', async () => {
  const repository = {
    async createScrapeJob() { return 'job-1'; }, async upsertCreators() { return { inserted: 0, updated: 0 }; }, async finishScrapeJob() {},
  };
  await assert.rejects(() => runInstagramPublicDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    seeds: [{ keyword: 'beauty', category: 'Beauty & Personal Care' }],
    fetchImpl: async () => ({ ok: false, status: 429 }),
  }), error => error.code === 'PUBLIC_DISCOVERY_THROTTLED');
});

test('public discovery stops safely when a search result page asks for verification', async () => {
  const repository = { async createScrapeJob() { return 'job'; }, async upsertCreators() { return { inserted: 0, updated: 0 }; }, async finishScrapeJob() {} };
  await assert.rejects(() => runInstagramPublicDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    seeds: [{ keyword: 'beauty', category: 'Beauty' }],
    fetchImpl: async () => ({ ok: true, text: async () => '<html>Verify you are human</html>' }),
  }), error => error.code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED' && error.searchDiagnostic?.possibleVerificationPage === true);
});
