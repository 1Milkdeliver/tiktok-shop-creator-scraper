'use strict';

// Read-only acceptance check for one explicitly supplied public Instagram
// profile. It never writes to a creator database and never prints Cookie,
// biography, email, or other profile values; only field-presence booleans.
const fs = require('node:fs');
const path = require('node:path');
const { runInstagramBrowserProfileCollection } = require('../lib/tasks/instagram-browser-profile-collector');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const userData = option('--user-data');
  const handle = option('--handle');
  const anonymous = process.argv.includes('--anonymous');
  if (!handle || (!anonymous && !userData)) throw new Error('Missing --handle or --user-data');
  let stateRoot = '';
  let sessionStatePath = '';
  if (!anonymous) {
    const appData = JSON.parse(fs.readFileSync(path.join(userData, 'app-data.json'), 'utf8'));
    const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
    if (!account?.accountRef) throw new Error('No imported Instagram account is available');
    stateRoot = path.join(userData, 'collector-state');
    sessionStatePath = path.join(stateRoot, 'instagram', account.accountRef, 'session.json');
  }
  const persisted = [];
  const repository = {
    async createScrapeJob() { return 'instagram-profile-smoke'; },
    async upsertCreators(rows) { persisted.push(...rows); return { inserted: rows.length, updated: 0 }; },
    async finishScrapeJob() {},
  };
  const result = await runInstagramBrowserProfileCollection({
    databaseManager: { async getRepository() { return repository; } },
    stateRoot,
    sessionStatePath,
    // An empty array is deliberate: no local Cookie, browser profile, or
    // account state is read for the anonymous public-page acceptance path.
    cookies: anonymous ? [] : undefined,
    handles: [handle],
    browserMode: 'headless',
    pageSettleMs: 2_000,
  });
  const row = persisted[0] || {};
  console.log(JSON.stringify({
    ok: result.ok,
    anonymous,
    profilesCompleted: Number(result.creators || 0),
    elapsedMs: Number(result.metrics?.elapsedMs || 0),
    successRate: Number(result.metrics?.successRate || 0),
    fieldsPresent: {
      handle: Boolean(row.handle),
      displayName: Boolean(row.nickname),
      followers: row.follower_cnt !== null && row.follower_cnt !== undefined && row.follower_cnt !== '',
      following: row.following_cnt !== null && row.following_cnt !== undefined && row.following_cnt !== '',
      posts: row.media_count !== null && row.media_count !== undefined && row.media_count !== '',
      biography: Boolean(row['简介']),
      publicEmail: Boolean(row['合作邮箱']),
      profileLink: Boolean(row['主页外链']),
      verification: Boolean(row['主页认证']),
      profileCategory: Boolean(row['主页类目']),
    },
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROFILE_SMOKE_FAILED', stage: error?.stage || null }));
  process.exitCode = 1;
});
