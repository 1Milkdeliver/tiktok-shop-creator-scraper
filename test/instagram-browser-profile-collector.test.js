'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeHandles, parseFollowerCount, extractPublicEmail, parseProfileSnapshot,
  parseProfileCounts, normalizePublicLink,
  runInstagramBrowserProfileCollection, loadProfilePage,
} = require('../lib/tasks/instagram-browser-profile-collector');

function repository(saved) {
  return {
    async createScrapeJob() { return 'job-1'; },
    async upsertCreators(rows) { saved.push(...rows); return { inserted: rows.length, updated: 0 }; },
    async finishScrapeJob() {},
  };
}

test('browser profile helpers normalize explicit targets and public visible fields', () => {
  assert.deepEqual(normalizeHandles(['@beauty.creator', 'https://instagram.com/home.notes/', 'BEAUTY.CREATOR', 'bad handle']), ['beauty.creator', 'home.notes']);
  assert.equal(parseFollowerCount('2.3M Followers, 84 Following'), '2.3M');
  assert.deepEqual(parseProfileCounts('2.3M Followers, 84 Following, 312 Posts'), { followers: '2.3M', following: '84', mediaCount: '312' });
  assert.equal(normalizePublicLink('https://creator.example/about'), 'https://creator.example/about');
  assert.equal(extractPublicEmail('Email: hello@example.test'), 'hello@example.test');
  const profile = parseProfileSnapshot({ handle: 'beauty.creator', title: 'Beauty Creator (@beauty.creator) · Instagram', description: '2.3M Followers, 84 Following, 312 Posts', visibleText: 'Beauty Creator\nBusiness: hello@example.test', externalLink: 'https://creator.example/about', isVerified: true, profileCategory: 'Digital creator' });
  assert.equal(profile.displayName, 'Beauty Creator');
  assert.equal(profile.followers, '2.3M');
  assert.equal(profile.contact.email, 'hello@example.test');
  assert.equal(profile.following, '84');
  assert.equal(profile.mediaCount, '312');
  assert.equal(profile.externalLink, 'https://creator.example/about');
  assert.equal(profile.isVerified, 'verified');
  const headerCountProfile = parseProfileSnapshot({ handle: 'home.notes', title: 'Home Notes (@home.notes) · Instagram', description: 'Home Notes on Instagram', headerText: 'Home Notes\n4.5K Followers\n215 Following\n78 Posts', visibleText: '' });
  assert.equal(headerCountProfile.followers, '4.5K');
  assert.equal(headerCountProfile.following, '215');
  assert.equal(headerCountProfile.mediaCount, '78');
  const accessibleCountProfile = parseProfileSnapshot({ handle: 'pet.daily', title: 'Pet Daily (@pet.daily) · Instagram', description: '', visibleText: '', accessibleText: '1.2万 位粉丝\n460 关注中\n98 帖子' });
  assert.equal(accessibleCountProfile.followers, '1.2万');
  assert.equal(accessibleCountProfile.following, '460');
  assert.equal(accessibleCountProfile.mediaCount, '98');
});

test('browser profile collector persists one public snapshot per requested handle', async () => {
  const saved = [];
  const calls = [];
  const page = {
    async setCookie(...cookies) { calls.push(['cookies', cookies.length]); },
    async goto(url) { calls.push(['goto', url]); return { status: () => 200 }; },
    async evaluate() { return { title: 'Beauty Creator (@beauty.creator) · Instagram', description: '1.2K Followers, 5 Following', visibleText: 'Contact hello@example.test' }; },
  };
  const browser = { async newPage() { return page; }, async close() { calls.push(['close']); } };
  const result = await runInstagramBrowserProfileCollection({
    databaseManager: { async getRepository() { return repository(saved); } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    handles: ['beauty.creator'], createBrowser: async () => browser, waitFor: async () => {}, pageSettleMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.creators, 1);
  assert.equal(saved[0].handle, '@beauty.creator');
  assert.equal(saved[0].合作邮箱, 'hello@example.test');
  assert.equal(saved[0].contact_email_provenance, 'instagram:visible-browser-profile');
  assert.deepEqual(calls.filter(call => call[0] === 'goto'), [['goto', 'https://www.instagram.com/beauty.creator/']]);
  assert.equal(calls.at(-1)[0], 'close');
});

test('browser profile collector stops immediately on a 429', async () => {
  const calls = [];
  const browser = {
    async newPage() { return { async setCookie() {}, async goto() { calls.push('goto'); return { status: () => 429 }; } }; },
    async close() { calls.push('close'); },
  };
  await assert.rejects(() => runInstagramBrowserProfileCollection({
    databaseManager: { async getRepository() { return repository([]); } },
    cookies: [{ name: 'sessionid', value: 'opaque', domain: '.instagram.com', path: '/', secure: true }],
    handles: ['beauty.creator'], createBrowser: async () => browser,
  }), error => error.code === 'THROTTLED');
  assert.deepEqual(calls, ['goto', 'close']);
});

test('anonymous public profile mode never reports a missing Cookie as a session-reimport requirement', async () => {
  const page = { async goto() { return { status: () => 403 }; }, url() { return 'https://www.instagram.com/accounts/login/'; } };
  await assert.rejects(() => loadProfilePage({
    page, handle: 'public.creator', onProgress: () => {}, waitFor: async () => {}, retryDelaysMs: [], browserMode: 'headless', hasSession: false,
  }), error => error.code === 'INSTAGRAM_PUBLIC_PROFILE_ATTENTION_REQUIRED');
});

test('browser profile collector retries a transient page response within its bounded budget', async () => {
  const saved = [];
  const waits = [];
  const phases = [];
  let attempts = 0;
  const page = {
    async setCookie() {},
    async goto() { attempts += 1; return { status: () => attempts === 1 ? 503 : 200 }; },
    async evaluate() { return { title: 'Retry Creator (@retry.creator) · Instagram', description: '12 Followers', visibleText: 'Retry Creator' }; },
  };
  const browser = { async newPage() { return page; }, async close() {} };
  const result = await runInstagramBrowserProfileCollection({
    databaseManager: { async getRepository() { return repository(saved); } },
    cookies: [], handles: ['retry.creator'], createBrowser: async () => browser,
    navigationRetryDelaysMs: [1_000], waitFor: async ms => waits.push(ms), onProgress: event => phases.push(event.phase), pageSettleMs: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1_000, 1]);
  assert.ok(phases.includes('browser_profile_navigation_retry'));
});

test('browser profile collector preserves an explicit public-browser provenance', async () => {
  const persisted = [];
  const page = {
    async setCookie() {},
    async goto() { return { status: () => 200 }; },
    async evaluate() { return { title: 'Sample Creator (@sample.creator) · Instagram', description: '12 Followers', visibleText: 'Sample Creator' }; },
  };
  const browser = { async newPage() { return page; }, async close() {} };
  const result = await runInstagramBrowserProfileCollection({
    databaseManager: { async getRepository() { return repository(persisted); } },
    cookies: [], handles: ['sample.creator'], collectionSource: 'instagram_anonymous_browser_profile',
    createBrowser: async () => browser, waitFor: async () => {}, pageSettleMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(persisted[0].collectionSource, 'instagram_anonymous_browser_profile');
});
