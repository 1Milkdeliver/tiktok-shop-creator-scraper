'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runDefaultInstagramDiscovery, DEFAULT_RESULTS_PER_SEED } = require('../lib/tasks/default-instagram-discovery');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('platform UI exposes a catalog-backed selector and scopes library/export requests', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const renderer = read('index.html');

  assert.match(main, /ipcMain\.handle\('platform-catalog'/);
  assert.match(main, /creatorRepository\(filters\?\.platformId\)/);
  assert.match(main, /creatorRepository\(platformId \|\| filters\.platformId\)/);
  assert.match(preload, /getPlatforms: \(\) => ipcRenderer\.invoke\('platform-catalog'\)/);
  assert.match(renderer, /id="creatorPlatformTabs"/);
  assert.match(renderer, /function renderCreatorPlatformTabs\(\)/);
  assert.match(renderer, /const order = \['tiktok_shop', 'instagram', 'youtube', 'x', 'tiktok'\]/);
  assert.match(renderer, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(renderer, /X（原 Twitter）/);
  assert.match(renderer, /tab\.onclick = \(\) => switchCreatorPlatform\(platform\.id\)/);
  assert.match(renderer, /id="exportPlatform"/);
  assert.match(renderer, /platformId: activeCreatorPlatform/);
  assert.match(renderer, /exportCreators\(\{ filters, format, fields, headerLang, outPath: file, platformId: activeCreatorPlatform \}\)/);
});

test('platform UI keeps independent filter drafts and hides TikTok Shop-only fields outside Shop', () => {
  const renderer = read('index.html');

  assert.match(renderer, /const PLATFORM_FIELD_KEYS = \{/);
  assert.match(renderer, /instagram: \['handle'.*'video_engagement'/s);
  assert.match(renderer, /tiktok_shop: null/);
  assert.match(renderer, /function visibleCreatorFields\(\)/);
  assert.match(renderer, /const PLATFORM_FILTER_KEYS = \{/);
  assert.match(renderer, /function activeFilterDefs\(\)/);
  assert.match(renderer, /const hier = activeFilterDefs\(\)\.find\(d => d\.type === 'hierarchy'\);/);
  assert.match(renderer, /const platformFilterStates = new Map/);
  assert.match(renderer, /function activatePlatformFilterState\(platformId\)/);
  assert.match(renderer, /activatePlatformFilterState\(platformId\);/);
  assert.match(renderer, /'platform\.filterScope\.common': \{ zh:/);
  assert.match(renderer, /id="creatorPlatformFilterHint"/);
  assert.match(renderer, /id="exportPlatformFilterHint"/);
  assert.match(renderer, /previousRows\.innerHTML = ''/);
});

test('collection task workspace exposes each platform input and protects prerequisites', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const renderer = read('index.html');

  assert.match(renderer, /id="taskPlatformTabs"/);
  assert.match(renderer, /function renderTaskPlatformTabs\(\)/);
  assert.match(renderer, /function taskPlatformCanCollect\(platformId\)/);
  assert.match(renderer, /tab\.disabled = !supported/);
  assert.match(renderer, /function switchTaskPlatform\(platformId\)/);
  assert.match(renderer, /id="socialTaskConfig"/);
  assert.match(renderer, /id="socialAuthorization"/);
  assert.match(renderer, /id="socialNoAuth"/);
  assert.match(renderer, /id="connectionSetupSlot"/);
  assert.match(renderer, /id="connectionPlatformTabs"/);
  assert.match(renderer, /function renderConnectionPlatformTabs\(\)/);
  assert.match(renderer, /socialAuthorization: activePage === 'connections' && activeTaskPlatform !== 'tiktok_shop'/);
  assert.match(renderer, /accounts: activePage === 'connections' && activeTaskPlatform === 'tiktok_shop'/);
  assert.match(renderer, /Set YouTube collection target/);
  assert.match(renderer, /id="socialImportAccount"/);
  assert.match(renderer, /id="socialImportedAccounts"/);
  assert.match(renderer, /function renderSocialImportedAccounts\(accounts\)/);
  assert.match(renderer, /id="instagramCookiePaste"/);
  assert.match(renderer, /id="instagramCookiePasteImport"/);
  assert.match(renderer, /id="xPoolGuide"/);
  assert.match(renderer, /id="xPoolGuideSummary"/);
  assert.match(renderer, /id="socialTaskQuery"/);
  assert.match(renderer, /id="socialTaskHandles"/);
  assert.match(renderer, /function refreshTaskReadiness\(\)/);
  assert.match(renderer, /id="taskReadiness"/);
  assert.match(renderer, /if \(activeTaskPlatform !== 'tiktok_shop'\)/);
  assert.match(renderer, /\['youtube', 'instagram', 'x'\]\.includes\(activeCreatorPlatform\)/);
  assert.match(renderer, /switchTaskPlatform\(activeCreatorPlatform\);\s*showPage\('tasks'\)/);
  assert.match(preload, /runYouTubeCollection: \(payload\)/);
  assert.match(preload, /runSocialCollection: \(payload\)/);
  assert.match(preload, /importSocialAccountState: \(payload\)/);
  assert.match(preload, /importInstagramCookieJson: \(payload\)/);
  assert.match(preload, /removeSocialAccount: \(payload\)/);
  assert.match(main, /ipcMain\.handle\('creator-db-run-social-collection'/);
  assert.match(main, /runDefaultYouTubeDiscovery/);
  assert.match(main, /runDefaultInstagramDiscovery/);
  assert.match(main, /runInstagramHeadlessDiscovery/);
  assert.match(main, /const isInstagramAutomatic = platform === 'instagram' && payload\?\.mode === 'automatic'/);
  assert.match(main, /isInstagramAutomatic && !accountRef/);
  assert.match(main, /payload\?\.mode === 'automatic' && accountRef/);
  assert.match(main, /error\?\.code !== 'INSTAGRAM_SESSION_ATTENTION_REQUIRED'/);
  assert.match(main, /state: 'fallback_public_discovery'/);
  assert.match(main, /sessionNeedsReimport: true, recoveryMode: 'public_candidate_discovery'/);
  assert.match(renderer, /switched automatically to public candidate discovery/);
  assert.match(renderer, /public candidate discovery continued and saved/);
  assert.match(main, /sessionStatePath: file, stateRoot: state\.root/);
  assert.match(renderer, /value="public_discovery"/);
  assert.match(renderer, /Public discovery \(no Cookie\)/);
  assert.match(renderer, /mode === 'public_discovery' \? '' : \(account\?\.accountRef \|\| ''\)/);
  assert.match(main, /ipcMain\.handle\('social-import-state'/);
  assert.match(main, /ipcMain\.handle\('instagram-import-cookie-json'/);
  assert.match(main, /ipcMain\.handle\('social-remove-account'/);
  assert.match(main, /const pasted = typeof payload\?\.cookieText === 'string'/);
  assert.match(renderer, /importInstagramCookieJson\(\{ cookieText \}\)/);
});

test('Instagram platform connections keep the optional Hiker API key secure and off by default', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const renderer = read('index.html');

  assert.match(renderer, /id="instagramHikerPanel"/);
  assert.match(renderer, /Hiker API public-profile supplement/);
  assert.match(renderer, /optional paid supplement/i);
  assert.match(renderer, /function refreshInstagramHikerUi\(\)/);
  assert.match(renderer, /window\.api\.configureInstagramHiker\(\{ apiKey \}\)/);
  assert.match(renderer, /window\.api\.clearInstagramHiker\(\)/);
  assert.match(renderer, /input\.value = ''/);
  assert.match(renderer, /activeTaskPlatform !== 'instagram'/);
  assert.match(preload, /instagramHikerStatus: \(\) => ipcRenderer\.invoke\('instagram-hiker-status'\)/);
  assert.match(preload, /configureInstagramHiker: \(payload\) => ipcRenderer\.invoke\('instagram-hiker-configure', payload\)/);
  assert.match(preload, /clearInstagramHiker: \(\) => ipcRenderer\.invoke\('instagram-hiker-clear'\)/);
  assert.match(main, /credentialBroker\.write\('hiker_api', \{ apiKey/);
  assert.match(main, /configured: Boolean\(appData\.instagramHiker\?\.accountRef/);
});

test('automatic YouTube discovery keeps the TikTok Shop keyword taxonomy and labels stored creators', () => {
  const defaults = read('lib/discovery/ecommerce-defaults.js');
  const collector = read('lib/tasks/default-youtube-discovery.js');
  const persistence = read('lib/tasks/creator-persistence.js');
  const renderer = read('index.html');
  const main = read('main.js');

  assert.match(defaults, /DEFAULT_KEYWORDS/);
  assert.match(defaults, /DEFAULT_DISCOVERY_SEEDS/);
  assert.match(collector, /tiktok_shop_default_keywords/);
  assert.match(collector, /runLocalPythonCollection/);
  assert.match(persistence, /discoveryMetadata/);
  assert.match(renderer, /youtubeDiscoveryMode/);
  assert.match(renderer, /source_keyword/);
  assert.match(renderer, /keyword_category/);
  assert.match(renderer, /instagramDiscoveryMode/);
  assert.match(renderer, /instagramBrowserMode/);
  assert.match(renderer, /Browser public profile/);
  assert.match(renderer, /Anonymous public page/);
  assert.match(main, /const useAnonymousInstagramBrowser = platform === 'instagram' && payload\?\.provider === 'public_browser'/);
  assert.match(main, /!useHiker && !useAnonymousInstagramBrowser/);
  assert.match(main, /cookies: \[\]/);
  assert.match(renderer, /accountRef: provider === 'public_browser' \? ''/);
});

test('Instagram automatic discovery builds candidate-only seed jobs and stops immediately on throttling', async () => {
  const events = [];
  let calls = 0;
  let payload;
  await assert.rejects(
    runDefaultInstagramDiscovery({
      waitFor: async ms => events.push({ state: 'waited', ms }),
      onProgress: event => events.push(event),
      runCollection: async (options) => {
        calls += 1;
        payload = options.payload;
        const error = new Error('limited'); error.code = 'THROTTLED'; throw error;
      },
    }),
    error => error?.code === 'THROTTLED',
  );
  assert.equal(DEFAULT_RESULTS_PER_SEED, 1);
  assert.equal(calls, 1);
  assert.equal(payload.discoveryOnly, true);
  assert.ok(!events.some(event => event.state === 'cooling_down'));
  assert.ok(!events.some(event => event.state === 'waiting'));
});

test('collection fields are automatic and browser mode controls the detail boundary', () => {
  const renderer = read('index.html');

  assert.doesNotMatch(renderer, /name="scrapeMode"/);
  assert.doesNotMatch(renderer, /class="update-group"/);
  assert.match(renderer, /browserMode === 'headless' \? FIELDS\.filter\(field => !field\.detail\) : FIELDS/);
  assert.match(renderer, /const fields = mode === 'headless' \? FIELDS\.filter\(field => !field\.detail\)\.map\(field => field\.k\) : FIELDS\.map\(field => field\.k\)/);
  assert.match(renderer, /const updateFields = FIELDS\.map\(field => field\.k\)/);
  assert.match(renderer, /const detail = mode !== 'headless'/);
  assert.match(renderer, /Window and automatic modes collect every available field/);
  assert.match(renderer, /Headless mode automatically collects fields available in list views/);
});

test('overview aggregates four local libraries and opens platform-specific task setup', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const renderer = read('index.html');

  assert.match(main, /ipcMain\.handle\('workspace-overview'/);
  assert.match(main, /buildWorkspaceOverview\(/);
  assert.match(preload, /workspaceOverview: \(\) => ipcRenderer\.invoke\('workspace-overview'\)/);
  assert.match(renderer, /id="connectionsPage"/);
  assert.match(renderer, /data-page="connections"/);
  assert.match(renderer, /const allowed = \['overview', 'tasks', 'connections', 'creators', 'exports'\]/);
  assert.match(renderer, /id="taskMonitorWall"/);
  assert.match(renderer, /id="taskMonitorGrid"/);
  assert.match(renderer, /function renderTaskMonitorWall\(overview\)/);
  assert.match(renderer, /const monitorPlatformSlots = \['tiktok_shop', 'youtube', 'instagram', 'x'\]/);
  assert.match(renderer, /task\.platformId === platformId/);
  assert.match(renderer, /id: 'next-slot', platformId: 'next'/);
  assert.match(renderer, /function renderWorkspaceOverview\(\)/);
  assert.match(renderer, /switchTaskPlatform\(platform\.id\); showPage\('connections'\)/);
  assert.match(renderer, /showPage\('connections'\)/);
});

test('task execution panels and monitor progress stay scoped to their own platform', () => {
  const main = read('main.js');
  const renderer = read('index.html');
  const collector = read('lib/tasks/local-python-collector.js');

  assert.match(renderer, /const isShopTaskContext = activePage === 'tasks' && activeTaskPlatform === 'tiktok_shop'/);
  assert.match(renderer, /log\.classList\.remove\('page-hidden'\)/);
  assert.match(renderer, /function appendTaskLog\(platformId, message\)/);
  assert.match(renderer, /function collectionProgressLog\(progress\)/);
  assert.match(renderer, /Run metrics:/);
  assert.match(renderer, /stop\.classList\.toggle\('page-hidden', !isShop\)/);
  assert.match(renderer, /const platformTaskProgress = new Map\(\)/);
  assert.match(renderer, /function updateLivePlatformTask\(progress\)/);
  assert.match(renderer, /task\.liveMessage \|\| \(task\.error/);
  assert.match(main, /collection-progress', \{ platform: 'youtube'/);
  assert.match(main, /collection-progress', \{ platform, \.\.\.progress \}/);
  assert.match(collector, /if \(event\.type === 'progress'\)/);
  assert.match(collector, /options\.onProgress\?\.\(/);
});
