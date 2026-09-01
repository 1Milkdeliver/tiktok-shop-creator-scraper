'use strict';

// Real-database acceptance check.  This intentionally writes one candidate
// discovery seed into the application's Instagram library, then verifies the
// durable rows without printing handles, profile data, or session material.
const fs = require('node:fs');
const path = require('node:path');
const { PlatformDatabaseManager } = require('../lib/database/manager');
const { runInstagramHeadlessDiscovery } = require('../lib/tasks/instagram-headless-discovery');
const { runInstagramPublicDiscovery } = require('../lib/tasks/instagram-public-discovery');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const userData = option('--user-data');
  const keyword = option('--keyword') || 'beauty';
  const provider = option('--provider') === 'public' ? 'public' : 'browser';
  if (!userData) throw new Error('Missing --user-data');
  const appData = JSON.parse(fs.readFileSync(path.join(userData, 'app-data.json'), 'utf8'));
  const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
  if (provider === 'browser' && !account?.accountRef) throw new Error('No imported Instagram account is available');
  const stateRoot = path.join(userData, 'collector-state');
  const sessionStatePath = path.join(stateRoot, 'instagram', account.accountRef, 'session.json');
  const manager = new PlatformDatabaseManager(path.join(userData, 'data'));
  try {
    const repository = await manager.getRepository('instagram');
    const before = await repository.getStats();
    const runOptions = { databaseManager: manager, region: 'GLOBAL', seeds: [{ keyword, category: 'Beauty & Personal Care' }], maxResultsPerSeed: 10 };
    const result = provider === 'public'
      ? await runInstagramPublicDiscovery(runOptions)
      : await runInstagramHeadlessDiscovery({ ...runOptions, sessionStatePath, stateRoot, pageSettleMs: 1_500 });
    const after = await repository.getStats();
    const rows = (await repository.listCreators({ limit: 100, fieldFilters: { source_keyword: [keyword] } })).rows;
    const expectedSource = provider === 'public' ? 'search_engine_public_result' : 'instagram_browser_search';
    const candidateRows = rows.filter(row => row.discovery_source === expectedSource);
    const uniqueCreatorIds = new Set(candidateRows.map(row => row.creator_id).filter(Boolean));
    console.log(JSON.stringify({
      ok: result.ok,
      beforeCreators: Number(before.creators || 0),
      afterCreators: Number(after.creators || 0),
      saved: Number(result.database?.saved || 0),
      inserted: Number(result.database?.inserted || 0),
      updated: Number(result.database?.updated || 0),
      verification: {
        candidateRows: candidateRows.length,
        uniqueCreatorIds: uniqueCreatorIds.size,
        allHaveKeywordCategory: candidateRows.every(row => row.keyword_category === 'Beauty & Personal Care'),
        allPendingProfileCheck: candidateRows.every(row => provider === 'public' ? row.verificationStatus === 'pending_local_profile_check' : row.verificationStatus === 'pending_profile_check'),
        allUseExpectedSource: candidateRows.every(row => row.discovery_source === expectedSource),
      },
    }));
  } finally {
    await manager.closeAll();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'DATABASE_ACCEPTANCE_FAILED', stage: error?.stage || null }));
  process.exitCode = 1;
});
