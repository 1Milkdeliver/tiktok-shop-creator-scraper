'use strict';

// Real-database acceptance check for one explicitly supplied public profile.
// It reports only field presence and provenance, never the actual profile,
// session, biography, or contact values.
const fs = require('node:fs');
const path = require('node:path');
const { PlatformDatabaseManager } = require('../lib/database/manager');
const { runInstagramBrowserProfileCollection } = require('../lib/tasks/instagram-browser-profile-collector');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const userData = option('--user-data');
  const handle = option('--handle');
  const anonymous = process.argv.includes('--anonymous');
  if (!userData || !handle) throw new Error('Missing --user-data or --handle');
  const appData = JSON.parse(fs.readFileSync(path.join(userData, 'app-data.json'), 'utf8'));
  const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
  if (!anonymous && !account?.accountRef) throw new Error('No imported Instagram account is available');
  const stateRoot = path.join(userData, 'collector-state');
  const sessionStatePath = account?.accountRef ? path.join(stateRoot, 'instagram', account.accountRef, 'session.json') : '';
  const manager = new PlatformDatabaseManager(path.join(userData, 'data'));
  try {
    const repository = await manager.getRepository('instagram');
    const before = await repository.getStats();
    const result = await runInstagramBrowserProfileCollection({
      databaseManager: manager,
      region: 'GLOBAL',
      sessionStatePath,
      stateRoot,
      // Do not fall back to a stored Cookie when this acceptance test is
      // explicitly exercising the anonymous public-browser path.
      cookies: anonymous ? [] : undefined,
      collectionSource: anonymous ? 'instagram_anonymous_browser_profile' : undefined,
      handles: [handle],
      browserMode: 'headless',
      pageSettleMs: 2_000,
      discoveryMetadata: anonymous
        ? { collection_mode: 'custom', discovery_source: 'instagram_anonymous_browser_profile', source_keyword: '', keyword_category: '' }
        : undefined,
    });
    const after = await repository.getStats();
    const rows = (await repository.listCreators({ limit: 10, search: handle.replace(/^@/, '') })).rows;
    const row = rows.find(entry => String(entry.creator_id || '') === `instagram:${handle.replace(/^@/, '').toLowerCase()}`) || {};
    console.log(JSON.stringify({
      ok: result.ok,
      anonymous,
      beforeCreators: Number(before.creators || 0),
      afterCreators: Number(after.creators || 0),
      saved: Number(result.database?.saved || 0),
      inserted: Number(result.database?.inserted || 0),
      updated: Number(result.database?.updated || 0),
      verification: {
        hasHandle: Boolean(row.handle),
        hasNickname: Boolean(row.nickname),
        hasProfileUrl: Boolean(row.profileUrl),
        hasBio: Boolean(row['简介']),
        hasPublicEmail: Boolean(row['合作邮箱']),
        emailProvenance: row.contact_email_provenance === 'instagram:visible-browser-profile',
        profileChecked: row.verificationStatus === 'browser_profile_checked',
        sourceIsBrowserProfile: anonymous
          ? row.collectionSource === 'instagram_anonymous_browser_profile'
          : row.collectionSource === 'instagram_browser_profile',
      },
    }));
  } finally {
    await manager.closeAll();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROFILE_DATABASE_ACCEPTANCE_FAILED', stage: error?.stage || null }));
  process.exitCode = 1;
});
