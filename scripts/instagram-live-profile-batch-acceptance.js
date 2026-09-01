'use strict';

// Live, small-batch acceptance check for imported Instagram sessions.  It
// selects already-discovered local candidates, refreshes their visible public
// profile fields at the collector's normal safe pace, and reports only counts
// and booleans.  Handles, session data, emails and bios never reach stdout.
const fs = require('node:fs');
const path = require('node:path');
const { PlatformDatabaseManager } = require('../lib/database/manager');
const { runInstagramBrowserProfileCollection } = require('../lib/tasks/instagram-browser-profile-collector');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

async function main() {
  const userData = option('--user-data');
  const count = positiveInteger(option('--count'), 3, 5);
  const profileGapMs = positiveInteger(option('--profile-gap-ms'), 45_000, 5 * 60_000);
  const resultFile = option('--result-file');
  if (!userData) throw new Error('Missing --user-data');
  const appData = JSON.parse(fs.readFileSync(path.join(userData, 'app-data.json'), 'utf8'));
  const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
  if (!account?.accountRef) throw new Error('No imported Instagram account is available');
  const stateRoot = path.join(userData, 'collector-state');
  const sessionStatePath = path.join(stateRoot, 'instagram', account.accountRef, 'session.json');
  const manager = new PlatformDatabaseManager(path.join(userData, 'data'));
  try {
    const repository = await manager.getRepository('instagram');
    const candidates = (await repository.listCreators({ limit: 100 })).rows
      .map(row => String(row.handle || '').replace(/^@/, '').trim())
      .filter(handle => /^[a-z0-9._]{1,30}$/i.test(handle))
      .slice(0, count);
    if (!candidates.length) {
      const error = new Error('No Instagram candidates are available');
      error.code = 'INSTAGRAM_CANDIDATE_REQUIRED';
      throw error;
    }
    const before = await repository.getStats();
    const result = await runInstagramBrowserProfileCollection({
      databaseManager: manager,
      region: 'GLOBAL',
      sessionStatePath,
      stateRoot,
      handles: candidates,
      browserMode: 'headless',
      profileGapMs,
      pageSettleMs: 2_000,
      discoveryMetadata: { collection_mode: 'browser_profile_refresh', discovery_source: 'local_candidate_batch', source_keyword: '', keyword_category: '' },
    });
    const refreshedRows = (await repository.listCreators({ limit: 100 })).rows
      .filter(row => candidates.includes(String(row.handle || '').replace(/^@/, '').toLowerCase()));
    const after = await repository.getStats();
    const summary = {
      ok: result.ok,
      requestedProfiles: candidates.length,
      completedProfiles: Number(result.creators || 0),
      beforeCreators: Number(before.creators || 0),
      afterCreators: Number(after.creators || 0),
      saved: Number(result.database?.saved || 0),
      inserted: Number(result.database?.inserted || 0),
      updated: Number(result.database?.updated || 0),
      metrics: {
        successRate: Number(result.metrics?.successRate || 0),
        elapsedMs: Number(result.metrics?.elapsedMs || 0),
        recordsPerMinute: Number(result.metrics?.recordsPerMinute || 0),
      },
      verification: {
        rowsMatched: refreshedRows.length,
        allProfileChecked: refreshedRows.length === candidates.length && refreshedRows.every(row => row.verificationStatus === 'browser_profile_checked'),
        allHaveHandleAndUrl: refreshedRows.length === candidates.length && refreshedRows.every(row => Boolean(row.handle) && Boolean(row.profileUrl)),
        allHaveBrowserProvenance: refreshedRows.length === candidates.length && refreshedRows.every(row => row.collectionSource === 'instagram_browser_profile'),
        rowsWithBio: refreshedRows.filter(row => Boolean(row['简介'])).length,
        rowsWithPublicEmail: refreshedRows.filter(row => Boolean(row['合作邮箱'])).length,
        rowsWithEmailProvenance: refreshedRows.filter(row => row.contact_email_provenance === 'instagram:visible-browser-profile').length,
      },
    };
    const output = JSON.stringify(summary);
    if (resultFile) fs.writeFileSync(path.resolve(resultFile), output, 'utf8');
    console.log(output);
  } finally {
    await manager.closeAll();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROFILE_BATCH_ACCEPTANCE_FAILED', stage: error?.stage || null }));
  process.exitCode = 1;
});
