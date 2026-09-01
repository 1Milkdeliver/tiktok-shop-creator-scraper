'use strict';

// One low-frequency keyword collection pass: discover public candidates, then
// enrich each candidate's public profile.  It never deletes creator records.
const fs = require('node:fs');
const path = require('node:path');
const { PlatformDatabaseManager } = require('../lib/database/manager');
const { runInstagramHeadlessDiscovery } = require('../lib/tasks/instagram-headless-discovery');
const { runInstagramBrowserProfileCollection } = require('../lib/tasks/instagram-browser-profile-collector');

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function safeResultFile(value) {
  return value ? path.resolve(value) : '';
}

function writeSummary(filePath, summary) {
  if (filePath) fs.writeFileSync(filePath, JSON.stringify(summary), 'utf8');
}

async function main() {
  const userData = option('--user-data');
  const keyword = option('--keyword');
  const category = option('--category');
  const resultFile = safeResultFile(option('--result-file'));
  if (!userData || !keyword || !category) throw new Error('Missing --user-data, --keyword, or --category');

  const appData = JSON.parse(fs.readFileSync(path.join(userData, 'app-data.json'), 'utf8'));
  const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
  if (!account?.accountRef) throw new Error('No imported Instagram account is available');

  const stateRoot = path.join(userData, 'collector-state');
  const sessionStatePath = path.join(stateRoot, 'instagram', account.accountRef, 'session.json');
  const manager = new PlatformDatabaseManager(path.join(userData, 'data'));
  try {
  const repository = await manager.getRepository('instagram');
  const handles = new Set();
  const capturingRepository = new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'upsertCreators') {
        return async rows => {
          for (const row of Array.isArray(rows) ? rows : []) {
            if (typeof row?.handle === 'string') handles.add(row.handle);
          }
          return target.upsertCreators(rows);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const discoveryResult = await runInstagramHeadlessDiscovery({
    databaseManager: { getRepository: async () => capturingRepository },
    stateRoot,
    sessionStatePath,
    seeds: [{ keyword, category }],
    maxResultsPerSeed: 10,
    // A small number of ordinary result-page scrolls lets automatic discovery
    // move beyond the first visible candidates without increasing request rate.
    candidateScrollPasses: 2,
    seedGapMs: 90_000,
    pageSettleMs: 1_500,
  });

  // When the page only contains creators already in the local library, there
  // is nothing to enrich. Treat that as a successful zero-new-candidate pass
  // rather than invoking the profile collector with an empty handle list.
  if (!handles.size) {
    writeSummary(resultFile, {
      ok: true,
      candidates: 0,
      saved: Number(discoveryResult?.database?.saved || 0),
      inserted: Number(discoveryResult?.database?.inserted || 0),
      updated: Number(discoveryResult?.database?.updated || 0),
      skipped: 'NO_NEW_CANDIDATES',
    });
    return;
  }

  const result = await runInstagramBrowserProfileCollection({
    databaseManager: manager,
    stateRoot,
    sessionStatePath,
    handles: [...handles],
    collectionSource: 'instagram_cookie_browser_profile',
    discoveryMetadata: { mode: 'automatic', keyword, category, source: 'instagram_keyword_profile_collection' },
  });
  const summary = {
    ok: true,
    candidates: handles.size,
    // Discovery creates the first durable candidate record; profile
    // enrichment then updates it. Report both phases so the endurance runner
    // can distinguish genuinely new creators from repeat refreshes.
    saved: Number(discoveryResult?.database?.saved || 0) + Number(result?.database?.saved || result?.creators || 0),
    inserted: Number(discoveryResult?.database?.inserted || 0) + Number(result?.database?.inserted || 0),
    updated: Number(discoveryResult?.database?.updated || 0) + Number(result?.database?.updated || 0),
  };
  writeSummary(resultFile, summary);
  console.log(JSON.stringify(summary));
  } finally {
    await manager.closeAll();
  }
}

main().catch(error => {
  const resultFile = safeResultFile(option('--result-file'));
  const summary = { ok: false, code: error?.code || 'INSTAGRAM_COLLECTION_FAILED', stage: error?.stage || null };
  writeSummary(resultFile, summary);
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
});
