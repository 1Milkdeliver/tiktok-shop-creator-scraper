'use strict';

// A bounded, no-Cookie acceptance probe for a known public Instagram profile.
// It reports aggregate verification only and writes to an isolated test DB.
const fs = require('node:fs');
const path = require('node:path');
const { PlatformDatabaseManager } = require('../lib/database/manager');
const { runInstagramBrowserProfileCollection } = require('../lib/tasks/instagram-browser-profile-collector');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const handle = option('--handle').replace(/^@/, '').trim();
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) {
    const error = new Error('A single valid public handle is required');
    error.code = 'INSTAGRAM_HANDLE_REQUIRED';
    throw error;
  }
  const dataDir = option('--data-dir') || path.join('test-results', 'instagram-public-profile-acceptance-data');
  const resultFile = option('--result-file');
  fs.mkdirSync(path.resolve(dataDir), { recursive: true });
  const manager = new PlatformDatabaseManager(path.resolve(dataDir));
  try {
    const result = await runInstagramBrowserProfileCollection({
      databaseManager: manager,
      region: 'GLOBAL',
      handles: [handle],
      // An explicit empty array is required: no session state is read.
      cookies: [],
      browserMode: 'headless',
      pageSettleMs: 2_000,
      profileGapMs: 60_000,
      collectionSource: 'instagram_anonymous_browser_profile',
      discoveryMetadata: { collection_mode: 'anonymous_public_profile', discovery_source: 'user_handle', source_keyword: '', keyword_category: '' },
    });
    const repository = await manager.getRepository('instagram');
    const rows = (await repository.listCreators({ limit: 5 })).rows;
    const summary = {
      ok: result.ok,
      provider: 'anonymous_public_browser',
      requestedProfiles: 1,
      completedProfiles: Number(result.creators || 0),
      saved: Number(result.database?.saved || 0),
      successRate: Number(result.metrics?.successRate || 0),
      elapsedMs: Number(result.metrics?.elapsedMs || 0),
      // These only validate the shape/provenance, never disclose field values.
      verifiedRows: rows.length,
      allHavePublicProfileProvenance: rows.length === 1 && rows.every(row => row.collectionSource === 'instagram_anonymous_browser_profile'),
      allHaveHandleAndUrl: rows.length === 1 && rows.every(row => Boolean(row.handle) && Boolean(row.profileUrl)),
      sessionLoaded: false,
    };
    if (resultFile) fs.writeFileSync(path.resolve(resultFile), JSON.stringify(summary), 'utf8');
    console.log(JSON.stringify(summary));
  } finally {
    await manager.closeAll();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, provider: 'anonymous_public_browser', code: error?.code || 'PUBLIC_PROFILE_ACCEPTANCE_FAILED', stage: error?.stage || null, sessionLoaded: false }));
  process.exitCode = 1;
});
