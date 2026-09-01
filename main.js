// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
// main.js — Electron main process: native window, native folder picker, scrape orchestration
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage, powerMonitor } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const product = require('./product.config');
process.env.CREATOR_SINGLE_PLATFORM = product.platformId;
app.setName(product.productName);
const { MultiRunner } = require('./lib/multirunner');
const { createTikTokShopAdapter, PLATFORM_CATALOG, isPlatformId } = require('./lib/platforms');
const { TaskSupervisor } = require('./lib/tasks/supervisor');
const { runYouTubeFixtureCollection } = require('./lib/tasks/youtube-fixture-collector');
const { runLocalPythonCollection } = require('./lib/tasks/local-python-collector');
const { runDefaultYouTubeDiscovery } = require('./lib/tasks/default-youtube-discovery');
const { runDefaultInstagramDiscovery } = require('./lib/tasks/default-instagram-discovery');
const { runInstagramPublicDiscovery } = require('./lib/tasks/instagram-public-discovery');
const { runInstagramHeadlessDiscovery } = require('./lib/tasks/instagram-headless-discovery');
const { runInstagramBrowserProfileCollection } = require('./lib/tasks/instagram-browser-profile-collector');
const { runHikerInstagramProfileEnrichment } = require('./lib/tasks/hiker-instagram-collector');
const { assertInstagramAvailable, nextInstagramCooldown } = require('./lib/tasks/instagram-cooldown');
const { InstagramIdleCoverageScheduler } = require('./lib/tasks/instagram-idle-coverage-scheduler');
const { InstagramCollectionLane } = require('./lib/tasks/instagram-collection-lane');
const { discoveryMetadata } = require('./lib/discovery/ecommerce-defaults');
const { PlatformDatabaseManager } = require('./lib/database');
const { CredentialBroker, SecretStore, EncryptedAppDataStorage, resolvePlatformStateDirectory } = require('./lib/credentials');
const { convertInstagramCookieExport, InstagramCookieImportError } = require('./lib/credentials/instagram-cookie-import');
const { WORKSPACE_PLATFORM_IDS, buildWorkspaceOverview } = require('./lib/workspace/overview-summary');

let mainWindow = null;
let creatorDb = null;
let creatorDbManager = null;
let credentialBroker = null;
let instagramIdleScheduler = null;
const instagramCollectionLane = new InstagramCollectionLane();
const runner = new MultiRunner();
// Keep the established runner instance (and its UI/database hooks) while all
// lifecycle entry points pass through the platform-neutral supervisor.
const taskSupervisor = new TaskSupervisor({
  adapters: { tiktok_shop: createTikTokShopAdapter({ runnerFactory: () => runner }) },
});
runner.onFileLog = (line) => writeLog(line);
runner.onDataReady = async (rows, config) => {
  if (!creatorDb) return { saved: 0, disabled: true };
  return creatorDb.upsertCreators(rows, {
    region: config.shopRegion || 'US',
    jobId: config.databaseJobId || null,
    updateFields: config.updateFields || null,
  });
};
// record history immediately when a run finishes (reliable, no polling)
runner.onDone = (result) => {
  try {
    const jobId = runner._currentJobId || null;
    if (jobId) result.jobId = jobId;
    if (creatorDb && jobId) {
      creatorDb.finishScrapeJob(jobId, result).catch(e => writeLog('任务状态写入数据库失败: ' + e.message));
    }
    // Auto-remove cookies that were CONFIRMED invalid during this run (landed
    // on the login/blank page). Cookies merely "expired by date" but still
    // working are NOT removed — the UI keeps them.
    if (result && result.ok) {
      const invalid = Array.isArray(result.invalidCookieIndexes) ? result.invalidCookieIndexes : [];
      if (invalid.length && Array.isArray(appData.cookies) && appData.cookies.length) {
        // remove from the highest index first so earlier indexes stay valid
        const removed = [];
        [...invalid].sort((a, b) => b - a).forEach(i => {
          if (i >= 0 && i < appData.cookies.length) { removed.push(appData.cookies.splice(i, 1)[0]); }
        });
        if (removed.length) {
          saveAppData();
          writeLog(`已自动移除 ${removed.length} 个确认失效的账号 Cookie`);
        }
      }
    }
    if (result && result.ok && !result.testMode) {
      runner._historyRecorded = true;
      // attach the run config so history entries can continue/refresh
      if (runner._lastConfig) result.config = runner._lastConfig;
      recordHistory(result);
    }
    runner._currentJobId = null;
  } catch (e) { }
};

// Keep the existing TikTok Shop database as the default, while every IPC
// caller can explicitly select one isolated platform repository.
function selectedPlatformId(value) {
  return isPlatformId(value) ? value : product.platformId;
}
async function creatorRepository(platformId) {
  if (!creatorDbManager) throw new Error('本地达人库未初始化');
  return creatorDbManager.getRepository(selectedPlatformId(platformId));
}

// ---- app folders: logs/ and output/ next to the executable ----
const APP_DIR = path.dirname(process.execPath);
const LOG_DIR = path.join(APP_DIR, 'logs');
const OUT_DIR = path.join(APP_DIR, 'output');

function ensureDirs() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    writeLog('目录就绪: ' + APP_DIR);
  } catch (e) {
    // if app dir is not writable (e.g. Program Files), fall back to userData
    try {
      const alt = path.join(app.getPath('userData'));
      const fallbackLog = path.join(alt, 'logs');
      const fallbackOut = path.join(alt, 'output');
      if (!fs.existsSync(fallbackLog)) fs.mkdirSync(fallbackLog, { recursive: true });
      if (!fs.existsSync(fallbackOut)) fs.mkdirSync(fallbackOut, { recursive: true });
      writeLog('安装目录不可写，使用用户目录: ' + alt);
    } catch (e2) { }
  }
}

// ---- rotating log writer (prevents oversized log files) ----
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB per file
const MAX_LOG_FILES = 5;
let logStream = null;

function openLogStream() {
  try {
    if (logStream) { try { logStream.end(); } catch (e) { } logStream = null; }
    // ensure dirs WITHOUT calling writeLog (avoid recursion)
    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) { }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const logFile = path.join(LOG_DIR, `app-${stamp}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
  } catch (e) {
    logStream = null;
  }
}

function rotateLogs() {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort();
    while (files.length > MAX_LOG_FILES) {
      const oldest = path.join(LOG_DIR, files.shift());
      fs.unlinkSync(oldest);
    }
  } catch (e) { }
}

function writeLog(msg) {
  try {
    const line = `[${new Date().toLocaleString()}] ${msg}\n`;
    if (!logStream) openLogStream();
    if (!logStream) {
      // fallback: write to userData logs if app dir not writable
      try {
        const altDir = path.join(app.getPath('userData'), 'logs');
        if (!fs.existsSync(altDir)) fs.mkdirSync(altDir, { recursive: true });
        fs.appendFileSync(path.join(altDir, 'app.log'), line);
      } catch (e) { }
      return;
    }
    // rotate if current file too big
    try {
      const size = fs.statSync(logStream.path).size;
      if (size > MAX_LOG_SIZE) openLogStream();
    } catch (e) { }
    if (logStream) logStream.write(line);
    rotateLogs();
  } catch (e) { }
}

// ---- persistent app data: remember last cookies + history ----
let appData = { cookies: [], history: [], socialAccounts: [], shortcutAsked: false, outDir: OUT_DIR };
function dataFile() { return path.join(app.getPath('userData'), 'app-data.json'); }

function loadAppData() {
  try {
    if (fs.existsSync(dataFile())) {
      appData = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
      if (!Array.isArray(appData.cookies)) appData.cookies = [];
      if (!Array.isArray(appData.socialAccounts)) appData.socialAccounts = [];
      if (!Array.isArray(appData.history)) appData.history = [];
      if (!appData.outDir) appData.outDir = OUT_DIR;
      // validate remembered outDir: if it no longer exists (e.g. leftover path
      // from an old install), fall back to the default so export never ENOENTs
      try {
        fs.mkdirSync(appData.outDir, { recursive: true });
      } catch (e) {
        appData.outDir = OUT_DIR;
        try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e2) { }
      }
    }
  } catch (e) { }
}
function saveAppData() {
  try { fs.writeFileSync(dataFile(), JSON.stringify(appData)); } catch (e) { }
}

function initializeCredentialBroker() {
  try {
    const storage = new EncryptedAppDataStorage({ appData, save: saveAppData, safeStorage });
    credentialBroker = new CredentialBroker({ secretStore: new SecretStore({
      storage,
      encrypt: value => value,
      decrypt: value => value,
    }) });
    writeLog('本地加密凭据存储就绪');
  } catch (e) {
    // The app remains usable for unauthenticated sources.  Never fall back to
    // plaintext storage when OS encryption is unavailable.
    credentialBroker = null;
    writeLog('本地加密凭据存储不可用');
  }
}

function instagramIdleCoverageConfig() {
  const saved = appData.instagramIdleCoverage && typeof appData.instagramIdleCoverage === 'object' ? appData.instagramIdleCoverage : {};
  return {
    enabled: saved.enabled === true,
    minIdleMinutes: Math.min(120, Math.max(5, Number(saved.minIdleMinutes) || 15)),
    scheduler: saved.scheduler && typeof saved.scheduler === 'object' ? saved.scheduler : null,
  };
}

function setupInstagramIdleCoverage() {
  if (!creatorDbManager) return;
  const config = instagramIdleCoverageConfig();
  instagramIdleScheduler?.stop();
  instagramIdleScheduler = new InstagramIdleCoverageScheduler({
    intervalMs: 5 * 60_000,
    isIdle: () => powerMonitor.getSystemIdleTime() >= instagramIdleCoverageConfig().minIdleMinutes * 60,
    isManualTaskRunning: () => instagramCollectionLane.isActive() || taskSupervisor.status().active,
    store: {
      load: () => instagramIdleCoverageConfig().scheduler,
      save: scheduler => {
        appData.instagramIdleCoverage = { ...instagramIdleCoverageConfig(), scheduler };
        saveAppData();
      },
    },
    onProgress: progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', { platform: 'instagram', ...progress });
    },
    runSeed: async ({ seed }) => {
      if (!instagramCollectionLane.tryAcquire()) {
        const error = new Error('Instagram collection lane is busy');
        error.code = 'INSTAGRAM_COLLECTION_BUSY';
        throw error;
      }
      let usedLocalInstagramSession = false;
      try {
        const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
        if (account && credentialBroker) {
          credentialBroker.read('instagram', account.accountRef);
          const { state, file } = socialStateFile('instagram', account.accountRef);
          if (fs.existsSync(file)) {
            usedLocalInstagramSession = true;
            const result = await runInstagramHeadlessDiscovery({
              databaseManager: creatorDbManager, region: 'GLOBAL', seeds: [seed], maxResultsPerSeed: 10,
              sessionStatePath: file, stateRoot: state.root,
              onProgress: progress => {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', { platform: 'instagram', idleCoverage: true, keyword: seed.keyword, category: seed.category, ...progress });
              },
            });
            setSocialAccountSessionStatus('instagram', account.accountRef, 'ready');
            return result;
          }
        }
        return await runInstagramPublicDiscovery({
          databaseManager: creatorDbManager, region: 'GLOBAL', seeds: [seed], maxResultsPerSeed: 10, seedGapMs: 15 * 60_000,
          onProgress: progress => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', { platform: 'instagram', idleCoverage: true, keyword: seed.keyword, category: seed.category, ...progress });
          },
        });
      } catch (error) {
        if (error?.code === 'INSTAGRAM_SESSION_ATTENTION_REQUIRED') {
          if (account) setSocialAccountSessionStatus('instagram', account.accountRef, 'needs_reimport');
          // Candidate discovery can continue from the public route while the
          // user repairs their local session. Profile enrichment remains
          // paused because it needs the authenticated browser session.
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', {
            platform: 'instagram', idleCoverage: true, state: 'fallback_public_discovery', keyword: seed.keyword, category: seed.category,
          });
          return await runInstagramPublicDiscovery({
            databaseManager: creatorDbManager, region: 'GLOBAL', seeds: [seed], maxResultsPerSeed: 10, seedGapMs: 15 * 60_000,
            onProgress: progress => {
              if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', { platform: 'instagram', idleCoverage: true, keyword: seed.keyword, category: seed.category, ...progress });
            },
          });
        }
        if (error?.code === 'PUBLIC_DISCOVERY_THROTTLED' || error?.code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED') {
          const verificationPage = error.code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED';
          error.code = 'THROTTLED';
          error.retryAt = Date.now() + (verificationPage ? 2 * 60 * 60_000 : 30 * 60_000);
        }
        // One local session backs both manual and idle collection. Share a
        // confirmed throttle window so a manual click cannot immediately
        // restart the same session while the idle queue is cooling down.
        if (error?.code === 'THROTTLED' && usedLocalInstagramSession) {
          const cooldown = nextInstagramCooldown(error);
          if (cooldown) {
            appData.instagramCooldown = cooldown;
            saveAppData();
            error.retryAt = cooldown.retryAt;
          }
        }
        throw error;
      } finally { instagramCollectionLane.release(); }
    },
  });
  if (config.enabled) instagramIdleScheduler.start();
}
function recordHistory(entry) {
  if (!entry || !entry.outPath) return;
  const abs = path.resolve(entry.outPath);
  const base = path.basename(abs); // e.g. 达人数据-20260820-123456.csv
  // dedupe: remove any existing entry with the same resolved path OR same
  // filename (robust against cwd differences between the two record paths)
  appData.history = (appData.history || []).filter(h => {
    if (!h.outPath) return true;
    const hAbs = path.resolve(h.outPath);
    const hBase = path.basename(hAbs);
    return hAbs !== abs && hBase !== base;
  });
  appData.history.unshift({
    outPath: entry.outPath,
    rows: entry.rows || 0,
    creators: entry.creators || 0,
    details: entry.details || 0,
    type: entry.type || 'scrape', // 'scrape' = run export, 'export' = manual filtered export
    time: new Date().toLocaleString(),
    config: entry.type === 'export' ? (entry.config || null) : entry.config ? {
      keywords: entry.config.keywords || [],
      shopRegion: entry.config.shopRegion || 'US',
      detail: !!entry.config.detail,
      dedupe: !!entry.config.dedupe,
      format: entry.config.format || 'csv',
      fields: entry.config.fields || null,
      mode: entry.config.mode || 'auto',
      headerLang: entry.config.headerLang || 'zh',
    } : null,
  });
  if (appData.history.length > 100) appData.history = appData.history.slice(0, 100);
  saveAppData();
}

// IPC: remembered cookies + history + default out dir
ipcMain.handle('get-app-data', () => ({ cookies: appData.cookies || [], history: appData.history || [], defaultOutDir: appData.outDir || OUT_DIR }));
ipcMain.handle('get-last-scrape-config', () => appData.lastScrapeConfig || null);
ipcMain.handle('clear-cookies', () => { appData.cookies = []; saveAppData(); return { ok: true }; });
ipcMain.handle('platform-catalog', () => PLATFORM_CATALOG.map(platform => ({ ...platform })));
ipcMain.handle('product-config', () => ({ platformId: product.platformId, productName: product.productName, maturity: product.maturity }));
// Offline integration hook only. It is deliberately unavailable to the
// renderer/preload bridge and remains gated unless an automated test launches
// Electron with ALLOW_FIXTURE_COLLECTORS=1. This proves the main-process
// worker->repository path without exposing a fake collection feature.
ipcMain.handle('creator-db-run-youtube-fixture', async (event, payload) => {
  if (product.platformId !== 'youtube') return { ok: false, error: 'WRONG_PRODUCT_PLATFORM' };
  if (process.env.ALLOW_FIXTURE_COLLECTORS !== '1') {
    return { ok: false, error: 'FIXTURE_COLLECTOR_DISABLED' };
  }
  try {
    return await runYouTubeFixtureCollection({
      databaseManager: creatorDbManager,
      scenario: payload?.scenario,
      region: payload?.region,
    });
  } catch (error) {
    return { ok: false, error: error.code || 'YOUTUBE_FIXTURE_COLLECTION_FAILED' };
  }
});
// The renderer may initiate only the credential-free YouTube discovery path.
// Other local workers stay behind their dedicated account/adapter flows until
// those flows are implemented and independently reviewed.
ipcMain.handle('creator-db-run-youtube-collection', async (event, payload) => {
  if (product.platformId !== 'youtube') return { ok: false, error: 'WRONG_PRODUCT_PLATFORM' };
  try {
    const reportProgress = progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', { platform: 'youtube', ...progress });
    };
    if (payload?.mode === 'default') {
      return await runDefaultYouTubeDiscovery({
        databaseManager: creatorDbManager,
        region: payload?.region || 'GLOBAL', sourceRegion: payload?.sourceRegion || 'US', language: payload?.language || 'en',
        maxResultsPerSeed: payload?.maxResultsPerSeed || 50,
        onProgress: reportProgress,
        runtimeOptions: { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
      });
    }
    return await runLocalPythonCollection({
      platformId: 'youtube',
      databaseManager: creatorDbManager,
      region: payload?.region,
      payload: {
        query: payload?.query,
        maxResults: payload?.maxResults,
        language: payload?.language,
        region: payload?.sourceRegion,
        resumeAfter: payload?.resumeAfter,
      },
      discoveryMetadata: discoveryMetadata({
        mode: 'custom', keyword: payload?.query, category: payload?.keywordCategory || '', source: 'user',
      }),
      onProgress: reportProgress,
      runtimeOptions: { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
    });
  } catch (error) {
    return { ok: false, error: error.code || 'YOUTUBE_COLLECTION_FAILED' };
  }
});
ipcMain.handle('creator-db-stats', async (event, platformId) => {
  try { return { ok: true, ...(await (await creatorRepository(platformId)).getStats()) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('workspace-overview', async () => {
  try {
    const results = await Promise.all(WORKSPACE_PLATFORM_IDS.map(async platformId => {
      const repository = await creatorRepository(platformId);
      const [stats, jobs] = await Promise.all([repository.getStats(), repository.listScrapeJobs({ limit: 5 })]);
      return { platformId, stats, jobs: jobs.rows || [] };
    }));
    const platformStats = Object.fromEntries(results.map(result => [result.platformId, result.stats]));
    const recentJobs = results.flatMap(result => result.jobs.map(job => ({
      id: job.id, platformId: result.platformId, status: job.status, startedAt: job.started_at,
      finishedAt: job.finished_at, rowsSaved: job.rows_saved, creatorsFound: job.creators_found, error: job.error,
      config: { region: job.config?.shopRegion || job.config?.region || null },
    }))).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))).slice(0, 5);
    return {
      ok: true,
      ...buildWorkspaceOverview({
        platformStats, cookieCount: appData.cookies?.length || 0, socialAccounts: appData.socialAccounts || [],
        activeTask: { ...taskSupervisor.status(), progress: runner.updateRateInfo() }, recentJobs,
      }),
    };
  } catch (error) { return { ok: false, error: 'WORKSPACE_OVERVIEW_UNAVAILABLE' }; }
});
ipcMain.handle('creator-db-list', async (event, filters) => {
  try { return { ok: true, ...(await (await creatorRepository(filters?.platformId)).listCreators(filters || {})) }; }
  catch (e) { return { error: e.message, rows: [], total: 0 }; }
});
ipcMain.handle('creator-db-ids', async (event, filters) => {
  try { return { ok: true, ids: await (await creatorRepository(filters?.platformId)).listCreatorIds(filters || {}) }; }
  catch (e) { return { error: e.message, ids: [] }; }
});
ipcMain.handle('creator-db-options', async (event, key, platformId) => {
  try { return { ok: true, options: await (await creatorRepository(platformId)).getFilterOptions(String(key || '')) }; }
  catch (e) { return { error: e.message, options: [] }; }
});

ipcMain.handle('creator-db-category-tree', async (event, platformId) => {
  try { return { ok: true, tree: await (await creatorRepository(platformId)).getCategoryTree() }; }
  catch (e) { return { error: e.message, tree: [] }; }
});
ipcMain.handle('creator-db-jobs', async (event, filters) => {
  try { return { ok: true, ...(await creatorRepository(filters?.platformId)).listScrapeJobs(filters || {}) }; }
  catch (e) { return { error: e.message, rows: [], total: 0 }; }
});

// Export the creator library (filtered) to CSV / XLSX. Returns the written file path.
ipcMain.handle('creator-db-export', async (event, payload) => {
  try {
    const { filters = {}, format = 'csv', fields = null, headerLang = 'zh', outPath, platformId } = payload || {};
    const repository = await creatorRepository(platformId || filters.platformId);
    if (!outPath) return { ok: false, error: '缺少输出路径' };
    const { exportCsv, exportXlsx, createCsvStream, ensureDir } = require('./lib/exporter');
    const FIELD_LABELS = {
      handle: { zh: '达人主页', en: 'Creator Page' }, nickname: { zh: '昵称', en: 'Nickname' }, creator_oecuid: { zh: '达人ID', en: 'Creator ID' },
      avatar: { zh: '头像', en: 'Avatar' }, selection_region: { zh: '地区', en: 'Region' }, follower_cnt: { zh: '粉丝数', en: 'Followers' },
      category: { zh: '类目', en: 'Category' }, med_gmv_revenue: { zh: '总GMV', en: 'Total GMV' }, med_gmv_revenue_range: { zh: 'GMV区间', en: 'GMV Range' },
      video_gmv: { zh: '视频GMV', en: 'Video GMV' }, live_gmv: { zh: '直播GMV', en: 'Live GMV' }, units_sold: { zh: '销量', en: 'Units Sold' },
      units_sold_range: { zh: '销量区间', en: 'Units Sold Range' }, video_avg_view_cnt: { zh: '平均视频观看', en: 'Avg Video Views' },
      video_play_cnt_med: { zh: '视频中位观看', en: 'Median Video Views' }, video_engagement: { zh: '视频互动量', en: 'Video Engagement' },
      ec_video_engagement: { zh: '电商视频互动', en: 'E-comm Video Engagement' }, ec_video_gpm: { zh: '电商GPM', en: 'E-comm GPM' },
      ec_live_gpm: { zh: '直播GPM', en: 'Live GPM' }, ec_live_avg_uv: { zh: '电商平均UV', en: 'E-comm Avg UV' },
      top_follower_ages: { zh: '粉丝年龄段', en: 'Audience Ages' }, top_follower_gender: { zh: '粉丝性别分布', en: 'Audience Gender' },
      pps_score: { zh: 'PPS评分', en: 'PPS Score' }, is_fast_growing: { zh: '快速增长', en: 'Fast Growing' }, has_collaborated: { zh: '已合作', en: 'Collaborated' },
      creator_permission_tag: { zh: '达人类目权限', en: 'Category Permission' }, is_live_auction: { zh: '直播拍卖', en: 'Live Auction' },
      '简介': { zh: '简介', en: 'Bio' }, '合作邮箱': { zh: '合作邮箱', en: 'Contact Email' }, 'MCN机构': { zh: 'MCN机构', en: 'MCN Agency' }, '垂直类目': { zh: '垂直类目', en: 'Vertical Category' },
      collection_mode: { zh: '采集方式', en: 'Collection Mode' }, discovery_source: { zh: '采集来源', en: 'Discovery Source' }, source_keyword: { zh: '来源关键词', en: 'Source Keyword' }, keyword_category: { zh: '关键词所属类目', en: 'Keyword Category' },
      last_publish_time: { zh: '最后发布时间', en: 'Last Published' }, activity_status: { zh: '活跃状态', en: 'Activity Status' }, activity_reason: { zh: '判断原因', en: 'Activity Reason' },
      last_refreshed_at: { zh: '最近更新', en: 'Last Updated' },
    };
    const label = k => (FIELD_LABELS[k] && FIELD_LABELS[k][headerLang]) || k;
    // export strategy:
    //  - CSV  → streaming, memory-flat, no row cap
    //  - XLSX → exceljs holds rows in memory (~55KB/row); export in batches of
    //           XLSX_BATCH_ROWS, one file per batch, so memory stays bounded
    //           even for very large result sets (auto multi-file export).
    const isXlsx = String(format).toLowerCase() === 'xlsx';
    const XLSX_BATCH_ROWS = 12000; // rows per xlsx file (~660MB peak per batch)
    const known = Object.keys(FIELD_LABELS);
    let offset = 0;
    const pageSize = 500;
    let writer = null; // CSV stream (created lazily after we know the fields)
    let pick = null;
    let headers = null;
    let rowCount = 0;
    let batchRows = []; // current xlsx batch
    let batchIndex = 0; // file suffix: 1, 2, 3...
    const writtenFiles = [];
    ensureDir(outPath);
    const flushXlsxBatch = async () => {
      if (!batchRows.length) return;
      batchIndex++;
      const filePath = batchIndex === 1 ? outPath : outPath.replace(/(\.xlsx)$/i, `-${batchIndex}$1`);
      await exportXlsx(filePath, batchRows, headers);
      writtenFiles.push(filePath);
      batchRows = [];
    };
    for (;;) {
      const page = await repository.listCreators({ ...filters, limit: pageSize, offset, sortBy: filters.sortBy || 'last_refreshed_at', sortDirection: filters.sortDirection || 'desc' });
      const rows = page.rows || [];
      if (!rows.length && offset === 0) return { ok: false, error: '筛选条件下没有数据可导出', rows: 0 };
      if (rows.length === 0) break;
      // first page decides which columns exist (only fields with data)
      if (!pick) {
        pick = (Array.isArray(fields) && fields.length) ? fields : known.filter(k => rows.some(r => r[k] !== undefined && r[k] !== null && r[k] !== ''));
        if (!pick.length) return { ok: false, error: '筛选条件下没有数据可导出', rows: 0 };
        headers = pick.map(label);
        if (!isXlsx) writer = createCsvStream(outPath, headers);
      }
      const out = rows.map(r => { const o = {}; for (const k of pick) o[label(k)] = r[k] ?? ''; return o; });
      if (isXlsx) {
        // fill batches; flush whenever the current batch would exceed the cap
        for (const row of out) {
          batchRows.push(row);
          if (batchRows.length >= XLSX_BATCH_ROWS) await flushXlsxBatch();
        }
      } else {
        writer.writeBatch(out);
      }
      rowCount += out.length;
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    if (isXlsx) await flushXlsxBatch(); // write any remaining rows
    else writer.end();
    // record manual filtered exports in history (type = 'export') so the user
    // can see/delete/update them separately from scrape-run exports. The
    // filters are stored so "update" can re-export with fresh library data.
    try {
      recordHistory({
        outPath: writtenFiles[0] || outPath, rows: rowCount, creators: rowCount, details: 0, type: 'export',
        config: {
          exportFilters: filters || {}, exportFormat: String(format).toLowerCase(),
          exportFields: Array.isArray(fields) ? fields : null, exportHeaderLang: String(headerLang || 'zh'),
          platformId: selectedPlatformId(platformId || filters.platformId),
        },
      });
    } catch (e) { }
    return { ok: true, outPath: writtenFiles[0] || outPath, rows: rowCount, files: writtenFiles };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Re-export a manual export file with the freshest library data, overwriting it.
// The history entry's stored filters determine the scope.
ipcMain.handle('update-export-file', async (event, filePath) => {
  try {
    const entry = (appData.history || []).find(h => path.resolve(h.outPath || '') === path.resolve(String(filePath || '')));
    if (!entry || entry.type !== 'export') return { ok: false, error: '未找到对应的导出记录' };
    const cfg = entry.config || {};
    const filters = cfg.exportFilters || {};
    const format = cfg.exportFormat || 'csv';
    const fields = cfg.exportFields || null;
    const headerLang = cfg.exportHeaderLang || 'zh';
    const repository = await creatorRepository(cfg.platformId);
    // reuse the export handler logic against the same output path
    const { exportCsv, exportXlsx, createCsvStream, ensureDir } = require('./lib/exporter');
    const FIELD_LABELS = {
      handle: { zh: '达人主页', en: 'Creator Page' }, nickname: { zh: '昵称', en: 'Nickname' }, creator_oecuid: { zh: '达人ID', en: 'Creator ID' },
      avatar: { zh: '头像', en: 'Avatar' }, selection_region: { zh: '地区', en: 'Region' }, follower_cnt: { zh: '粉丝数', en: 'Followers' },
      category: { zh: '类目', en: 'Category' }, med_gmv_revenue: { zh: '总GMV', en: 'Total GMV' }, med_gmv_revenue_range: { zh: 'GMV区间', en: 'GMV Range' },
      video_gmv: { zh: '视频GMV', en: 'Video GMV' }, live_gmv: { zh: '直播GMV', en: 'Live GMV' }, units_sold: { zh: '销量', en: 'Units Sold' },
      units_sold_range: { zh: '销量区间', en: 'Units Sold Range' }, video_avg_view_cnt: { zh: '平均视频观看', en: 'Avg Video Views' },
      video_play_cnt_med: { zh: '视频中位观看', en: 'Median Video Views' }, video_engagement: { zh: '视频互动量', en: 'Video Engagement' },
      ec_video_engagement: { zh: '电商视频互动', en: 'E-comm Video Engagement' }, ec_video_gpm: { zh: '电商GPM', en: 'E-comm GPM' },
      ec_live_gpm: { zh: '直播GPM', en: 'Live GPM' }, ec_live_avg_uv: { zh: '电商平均UV', en: 'E-comm Avg UV' },
      top_follower_ages: { zh: '粉丝年龄段', en: 'Audience Ages' }, top_follower_gender: { zh: '粉丝性别分布', en: 'Audience Gender' },
      pps_score: { zh: 'PPS评分', en: 'PPS Score' }, is_fast_growing: { zh: '快速增长', en: 'Fast Growing' }, has_collaborated: { zh: '已合作', en: 'Collaborated' },
      creator_permission_tag: { zh: '达人类目权限', en: 'Category Permission' }, is_live_auction: { zh: '直播拍卖', en: 'Live Auction' },
      '简介': { zh: '简介', en: 'Bio' }, '合作邮箱': { zh: '合作邮箱', en: 'Contact Email' }, 'MCN机构': { zh: 'MCN机构', en: 'MCN Agency' }, '垂直类目': { zh: '垂直类目', en: 'Vertical Category' },
      collection_mode: { zh: '采集方式', en: 'Collection Mode' }, discovery_source: { zh: '采集来源', en: 'Discovery Source' }, source_keyword: { zh: '来源关键词', en: 'Source Keyword' }, keyword_category: { zh: '关键词所属类目', en: 'Keyword Category' },
      last_publish_time: { zh: '最后发布时间', en: 'Last Published' }, activity_status: { zh: '活跃状态', en: 'Activity Status' }, activity_reason: { zh: '判断原因', en: 'Activity Reason' },
      last_refreshed_at: { zh: '最近更新', en: 'Last Updated' },
    };
    const label = k => (FIELD_LABELS[k] && FIELD_LABELS[k][headerLang]) || k;
    const isXlsx = String(format).toLowerCase() === 'xlsx';
    const XLSX_BATCH_ROWS = 12000; // rows per xlsx file; matches the export handler
    const known = Object.keys(FIELD_LABELS);
    let offset = 0;
    const pageSize = 500;
    let writer = null; // CSV stream
    let pick = null;
    let headers = null;
    let rowCount = 0;
    let batchRows = [];
    let batchIndex = 0;
    const writtenFiles = [];
    ensureDir(entry.outPath);
    // clean stale sibling batches (-2, -3…) from a previous update
    const base = entry.outPath.replace(/-\d+(\.xlsx)$/i, '$1');
    if (isXlsx) {
      try {
        const dir = path.dirname(base);
        const name = path.basename(base);
        for (const f of fs.readdirSync(dir)) {
          if (/^[\s\S]*-\d+\.xlsx$/i.test(f) && f.replace(/-\d+(\.xlsx)$/i, '.xlsx') === name) {
            fs.unlinkSync(path.join(dir, f));
          }
        }
      } catch (e) { }
    }
    const flushXlsxBatch = async () => {
      if (!batchRows.length) return;
      batchIndex++;
      const filePath = batchIndex === 1 ? base : base.replace(/(\.xlsx)$/i, `-${batchIndex}$1`);
      await exportXlsx(filePath, batchRows, headers);
      writtenFiles.push(filePath);
      batchRows = [];
    };
    for (;;) {
      const page = await repository.listCreators({ ...filters, limit: pageSize, offset, sortBy: filters.sortBy || 'last_refreshed_at', sortDirection: filters.sortDirection || 'desc' });
      const rows = page.rows || [];
      if (!rows.length && offset === 0) return { ok: false, error: '筛选条件下没有数据可更新', rows: 0 };
      if (rows.length === 0) break;
      if (!pick) {
        pick = (Array.isArray(fields) && fields.length) ? fields : known.filter(k => rows.some(r => r[k] !== undefined && r[k] !== null && r[k] !== ''));
        if (!pick.length) return { ok: false, error: '筛选条件下没有数据可更新', rows: 0 };
        headers = pick.map(label);
        if (!isXlsx) writer = createCsvStream(base, headers);
      }
      const out = rows.map(r => { const o = {}; for (const k of pick) o[label(k)] = r[k] ?? ''; return o; });
      if (isXlsx) {
        for (const row of out) {
          batchRows.push(row);
          if (batchRows.length >= XLSX_BATCH_ROWS) await flushXlsxBatch();
        }
      } else {
        writer.writeBatch(out);
      }
      rowCount += out.length;
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    if (isXlsx) await flushXlsxBatch();
    else writer.end();
    // refresh the history entry's row count + timestamp (point at first file)
    const primary = writtenFiles[0] || base;
    entry.outPath = primary;
    entry.rows = rowCount;
    entry.time = new Date().toLocaleString();
    saveAppData();
    return { ok: true, outPath: primary, rows: rowCount, history: appData.history || [] };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Read creator IDs from an existing CSV/XLSX export (for "继续抓取" dedupe)
function readExistingIds(filePath) {
  const ids = [];
  try {
    if (/\.xlsx$/i.test(filePath)) {
      const ExcelJS = require('exceljs');
      // async — callers await; but this is sync handler, so we read via workbook.load
    } else {
      const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return ids;
      const headers = parseCsvLine(lines[0]);
      const idIdx = headers.findIndex(h => h === '达人ID' || h === 'Creator ID' || h === 'creator_oecuid');
      if (idIdx < 0) return ids;
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        if (cells[idIdx]) ids.push(cells[idIdx]);
      }
    }
  } catch (e) { }
  return ids;
}
// minimal CSV line parser (handles quoted fields)
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ── import creators from a shared CSV/XLSX file ──
// Recognizes column headers by their Chinese/English/internal label and maps
// them into DB fields, then upserts every row that has a creator ID.
const IMPORT_FIELD_ALIASES = {
  creator_oecuid: ['达人ID', 'creator_id', 'creator_oecuid', 'creator id', 'id', 'oecuid'],
  handle: ['达人主页', 'handle', 'username', '昵称链接', '主页'],
  nickname: ['昵称', 'nickname', '达人名称', 'name', '达人名字'],
  selection_region: ['地区', 'region', 'selection_region', '站点'],
  follower_cnt: ['粉丝数', 'followers', 'follower_cnt', '粉丝数量', '粉丝'],
  category: ['类目', 'category', '一级类目', '擅长类目'],
  med_gmv_revenue: ['总GMV', 'total gmv', 'med_gmv_revenue', 'gmv'],
  units_sold: ['销量', 'units sold', 'units_sold', '成交件数'],
  video_avg_view_cnt: ['平均观看', 'avg views', 'video_avg_view_cnt', '平均视频观看', '平均播放量'],
  pps_score: ['PPS评分', 'pps score', 'pps_score', 'pps'],
  top_follower_ages: ['粉丝年龄段', 'ages', 'top_follower_ages', '年龄段'],
  top_follower_gender: ['粉丝性别', 'gender', 'top_follower_gender', '粉丝性别分布'],
  '简介': ['简介', 'bio', 'description'],
  '合作邮箱': ['合作邮箱', 'contact email', 'email', '邮箱', '合作邮箱email'],
  'MCN机构': ['MCN机构', 'mcn', 'mcn agency', 'mcn机构', '达人机构'],
  '垂直类目': ['垂直类目', 'vertical category', 'vertical', '二级类目'],
  last_publish_time: ['最后发布时间', 'last published', 'last_publish_time', '最近发布'],
  activity_status: ['活跃状态', 'activity status', 'activity', '活跃度'],
};
// build a lookup: normalized label -> internal field
const IMPORT_LABEL_MAP = (() => {
  const m = new Map();
  for (const [field, aliases] of Object.entries(IMPORT_FIELD_ALIASES)) {
    for (const a of aliases) m.set(a.toLowerCase().trim(), field);
  }
  return m;
})();
// ── streaming import: reads rows one batch at a time, so files of any size
// can be imported without loading everything into memory ──
// Returns { getHeaders(), mapColumns(), forEachBatch(async (batch) => ...) }
async function openImportSource(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.csv') {
    const readline = require('readline');
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    // NOTE: readline's async iterator drops lines when the consumer awaits a
    // slow operation between events. Use an event-driven queue with explicit
    // pause/resume so large files never lose rows.
    let headers = [];
    let resolveReady = null;
    const ready = new Promise(r => { resolveReady = r; });
    let queue = [];
    let waiters = [];
    let done = false;
    const QUEUE_LIMIT = 2000; // rows buffered ahead; beyond this we pause the stream
    rl.on('line', (line) => {
      if (line.trim() === '') return;
      if (!headers.length) { headers = parseCsvLine(line.replace(/^\uFEFF/, '')).map(h => String(h || '').trim()); resolveReady(); return; }
      queue.push(line);
      if (queue.length > QUEUE_LIMIT) rl.pause(); // backpressure: stop reading
      // hand a line to the first waiting consumer
      if (waiters.length) { const w = waiters.shift(); w(queue.shift()); }
    });
    rl.on('close', () => { done = true; resolveReady(); waiters.forEach(w => w(null)); waiters = []; });
    const nextLine = () => {
      if (queue.length) return Promise.resolve(queue.shift());
      if (done) return Promise.resolve(null);
      return new Promise(r => waiters.push(r));
    };
    const forEachBatch = async (onBatch) => {
      await ready;
      let batch = [];
      let count = 0;
      for (;;) {
        const line = await nextLine();
        if (line === null) break;
        // consumer drained below the limit → resume the stream
        if (queue.length <= QUEUE_LIMIT / 2 && !done) rl.resume();
        const cells = parseCsvLine(line);
        const row = {};
        for (let c = 0; c < headers.length; c++) row[headers[c]] = cells[c] === undefined ? '' : cells[c];
        batch.push(row);
        if (batch.length >= 500) {
          await onBatch(batch);
          count += batch.length;
          batch = [];
        }
      }
      if (batch.length) { await onBatch(batch); count += batch.length; }
      return count;
    };
    const getHeaders = async () => { await ready; return headers; };
    return { getHeaders, forEachBatch };
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.stream.xlsx.WorkbookReader(filePath, { entries: 'emit' });
    await wb.read(); // opens the zip, emits worksheets
    let ws = null;
    for await (const sheet of wb) { ws = sheet; break; }
    if (!ws) return { getHeaders: async () => [], forEachBatch: async () => 0 };
    const rowToValues = (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell) => { values[cell.col - 1] = cell.value; });
      return values;
    };
    // Single-pass reader: the first worksheet row is the header; it is cached so
    // getHeaders() can inspect it for column mapping, and forEachBatch skips it.
    let headers = null;
    const iterator = ws[Symbol.asyncIterator] ? ws[Symbol.asyncIterator]() : null;
    const nextRow = async () => {
      if (!iterator) return null;
      const r = await iterator.next();
      return r.done ? null : r.value;
    };
    const getHeaders = async () => {
      if (headers) return headers;
      const first = await nextRow();
      if (first) {
        headers = rowToValues(first).map(v => String(v === null || v === undefined ? '' : (typeof v === 'object' && v.text !== undefined ? v.text : v)).trim());
      } else {
        headers = [];
      }
      return headers;
    };
    const forEachBatch = async (onBatch) => {
      await getHeaders(); // ensures the header row is consumed exactly once
      let batch = [];
      let count = 0;
      for (;;) {
        const row = await nextRow();
        if (!row) break;
        const values = rowToValues(row);
        const obj = {};
        for (let c = 0; c < headers.length; c++) {
          const v = values[c];
          obj[headers[c]] = v === null || v === undefined ? '' : (typeof v === 'object' && v.text !== undefined ? v.text : String(v));
        }
        batch.push(obj);
        if (batch.length >= 500) { await onBatch(batch); count += batch.length; batch = []; }
      }
      if (batch.length) { await onBatch(batch); count += batch.length; }
      return count;
    };
    return { getHeaders, forEachBatch };
  }
  throw new Error('仅支持 CSV 或 Excel 文件');
}
ipcMain.handle('creator-db-import', async (event, payload) => {
  try {
    const repository = await creatorRepository(payload?.platformId);
    const filePath = payload && payload.filePath;
    if (!filePath) return { ok: false, error: '缺少文件路径' };
    const region = String((payload && payload.region) || 'US').toUpperCase();
    const source = await openImportSource(filePath);
    const headers = await source.getHeaders();
    if (!headers || !headers.length) return { ok: false, error: '文件没有表头行' };
    // map columns by recognized labels → internal fields
    const colMap = {};
    for (const h of headers) {
      const f = IMPORT_LABEL_MAP.get(String(h).toLowerCase().trim());
      if (f) colMap[h] = f;
    }
    if (!Object.values(colMap).includes('creator_oecuid')) {
      return { ok: false, error: '未识别到「达人ID」列（支持列名：达人ID / Creator ID / creator_oecuid / id）' };
    }
    // stream rows through upsert in batches (memory stays flat)
    let totalRows = 0;
    let inserted = 0;
    let updated = 0;
    await source.forEachBatch(async (batch) => {
      const mapped = batch.map(r => {
        const o = {};
        for (const [label, field] of Object.entries(colMap)) {
          const v = r[label];
          if (v !== undefined && v !== null && String(v).trim() !== '') o[field] = String(v).trim();
        }
        return o;
      });
      const dbRes = await repository.upsertCreators(mapped, { region });
      inserted += dbRes.inserted || 0;
      updated += dbRes.updated || 0;
      totalRows += mapped.length;
    });
    return { ok: true, inserted, updated, saved: inserted + updated, matched: Object.keys(colMap).length, rows: totalRows, skipped: totalRows - (inserted + updated) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// IPC: continue scraping based on a history entry (incremental, skips saved IDs)
ipcMain.handle('continue-history', async (event, filePath) => {
  try {
    const entry = (appData.history || []).find(h => path.resolve(h.outPath || '') === path.resolve(filePath || ''));
    if (!entry || !entry.config) return { ok: false, error: '该历史记录缺少抓取配置，无法继续（旧版本生成）' };
    if (runner.running) return { ok: false, error: '已有抓取任务在运行' };
    const existingIds = readExistingIds(entry.outPath);
    const cfg = {
      cookieFiles: entry.config.cookieFiles || [],
      mode: entry.config.mode || 'auto',
      format: entry.config.format || 'csv',
      outPath: path.dirname(entry.outPath),
      detail: !!entry.config.detail,
      headerLang: entry.config.headerLang || 'zh',
      shopRegion: entry.config.shopRegion || 'US',
      dedupe: true, // skip already-saved IDs
      existingIds,
      overwritePath: entry.outPath, // write back to the same file
      keywords: entry.config.keywords && entry.config.keywords.length ? entry.config.keywords : require('./lib/exporter').DEFAULT_KEYWORDS,
      fields: entry.config.fields || null,
    };
    // use remembered cookies if available
    if (appData.cookies && appData.cookies.length) {
      const { cookieFiles, error } = saveCookiesToFiles(appData.cookies);
      if (error) return { ok: false, error };
      cfg.cookieFiles = cookieFiles;
    }
    if (!cfg.cookieFiles.length) return { ok: false, error: '没有可用 Cookie，请先导入 Cookie' };
    const prevResult = runner.result;
    runner._lastConfig = cfg;
    taskSupervisor.start('tiktok_shop', cfg).catch(e => runner.log('继续抓取错误: ' + e.message));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// IPC: refresh a history entry (re-scrape all, overwrite the file)
ipcMain.handle('refresh-history', async (event, filePath) => {
  try {
    const entry = (appData.history || []).find(h => path.resolve(h.outPath || '') === path.resolve(filePath || ''));
    if (!entry || !entry.config) return { ok: false, error: '该历史记录缺少抓取配置，无法刷新（旧版本生成）' };
    if (runner.running) return { ok: false, error: '已有抓取任务在运行' };
    const cfg = {
      cookieFiles: entry.config.cookieFiles || [],
      mode: entry.config.mode || 'auto',
      format: entry.config.format || 'csv',
      outPath: path.dirname(entry.outPath),
      detail: !!entry.config.detail,
      headerLang: entry.config.headerLang || 'zh',
      shopRegion: entry.config.shopRegion || 'US',
      dedupe: false, // re-scrape everything
      overwritePath: entry.outPath,
      keywords: entry.config.keywords && entry.config.keywords.length ? entry.config.keywords : require('./lib/exporter').DEFAULT_KEYWORDS,
      fields: entry.config.fields || null,
    };
    if (appData.cookies && appData.cookies.length) {
      const { cookieFiles, error } = saveCookiesToFiles(appData.cookies);
      if (error) return { ok: false, error };
      cfg.cookieFiles = cookieFiles;
    }
    if (!cfg.cookieFiles.length) return { ok: false, error: '没有可用 Cookie，请先导入 Cookie' };
    const prevResult = runner.result;
    runner._lastConfig = cfg;
    taskSupervisor.start('tiktok_shop', cfg).catch(e => runner.log('刷新抓取错误: ' + e.message));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// IPC: open a history file with the system default app.
// If the file is gone (moved/deleted), drop the stale entry from history too.
ipcMain.handle('open-history-file', async (event, filePath) => {
  try {
    const abs = path.resolve(filePath || '');
    if (!fs.existsSync(abs)) {
      appData.history = (appData.history || []).filter(h => path.resolve(h.outPath || '') !== abs);
      saveAppData();
      return { ok: false, error: '文件不存在或已被移动/删除，已从历史记录移除', history: appData.history || [] };
    }
    const err = await shell.openPath(abs);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// IPC: copy a history file path to the clipboard
ipcMain.handle('copy-history-path', (event, filePath) => {
  try {
    const abs = path.resolve(filePath || '');
    clipboard.writeText(abs);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// IPC: open the folder containing a history file
ipcMain.handle('open-history-folder', (event, filePath) => {
  try {
    const abs = path.resolve(filePath || '');
    if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在: ' + abs };
    shell.showItemInFolder(abs);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// IPC: delete a history file (and remove the entry), then return the refreshed history
ipcMain.handle('delete-history-file', (event, filePath) => {
  try {
    const abs = path.resolve(filePath || '');
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    appData.history = (appData.history || []).filter(h => path.resolve(h.outPath || '') !== abs);
    saveAppData();
    return { ok: true, history: appData.history || [] };
  } catch (e) { return { ok: false, error: e.message }; }
});
// IPC: current app version (lazy require to avoid ordering issues)
ipcMain.handle('get-version', () => ({ version: require('./package.json').version }));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    // min width keeps the single-row header (version/status/buttons) fully
    // visible — the app refuses to shrink below it instead of clipping.
    minWidth: 1180,
    minHeight: 640,
    title: 'TikTokShop达人抓取工具',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile('index.html');
  // Open external links in the system browser, not this window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // ── confirm before closing while a scrape is active / data unsaved ──
  // Clicking the window X (or quitting from OS) normally discards in-memory
  // scraped data. Intercept 'close', ask the user, and if they choose "save",
  // run the normal stop→export flow and only quit after it completes.
  let allowClose = false;
  mainWindow.on('close', (e) => {
    if (allowClose) return;
    const busy = !!(runner && runner.running);
    if (!busy) return; // nothing in progress → close freely
    e.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '抓取进行中',
      message: '正在抓取，有未导出的数据',
      detail: busy
        ? '退出前可以选择保存已抓取的数据（结束抓取并立即导出），或直接退出丢弃本次数据。'
        : '',
      buttons: ['💾 保存并退出', '直接退出（丢弃本次数据）', '取消'],
      defaultId: 0,
      cancelId: 2,
      icon: path.join(__dirname, 'icon-256.png'),
    }).then(async ({ response }) => {
      if (response === 2) return; // cancel → stay open
      if (response === 0) {
        // save: trigger stop→export, wait for it to finish, then really quit
        try { runner.stop(); } catch (e) { }
        // poll until the runner is no longer running (or a hard cap)
        const deadline = Date.now() + 180000; // 3 min max for the export
        while (runner.running && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      allowClose = true;
      mainWindow.close();
    });
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- version check: query GitHub releases for the latest version ----
const CURRENT_VERSION = require('./package.json').version;
const REPO = '1Milkdeliver/tiktok-shop-creator-scraper';
const RELEASE_URL = `https://github.com/${REPO}/releases/latest`;

function parseVersion(v) {
  const m = String(v).replace(/^v/i, '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}
function isNewer(latest, cur) {
  const a = parseVersion(latest);
  const b = parseVersion(cur);
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) || (a[0] === b[0] && a[1] === b[1] && a[2] > b[2]);
}

// ---- auto-update: electron-updater downloads & installs the new build in-app ----
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = false; // ask the user first, then download
autoUpdater.autoInstallOnAppQuit = true;

// update state shared with the renderer (polled by the UI)
let updateState = { phase: 'idle', percent: 0, message: '' };
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('update-state', updateState); } catch (e) { }
  }
}

// Manual check triggered by the UI button
let isManualCheck = false;
ipcMain.handle('check-update', () => {
  isManualCheck = true;
  checkForUpdates(true);
  return { ok: true };
});

// Renderer clicked "立即下载更新" in the in-app update dialog
ipcMain.handle('start-update-download', async () => {
  try {
    setUpdateState({ phase: 'downloading', percent: 0, message: '开始下载更新…' });
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    setUpdateState({ phase: 'error', message: '下载失败: ' + e.message });
    writeLog('下载更新失败: ' + e.message);
    return { ok: false, error: String(e.message || e) };
  }
});

async function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual && mainWindow) {
      dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: '开发模式下不检查更新', detail: '请使用打包后的安装版。', icon: path.join(__dirname, 'icon-256.png') });
    }
    return;
  }
  setUpdateState({ phase: 'checking', percent: 0, message: '' });
  writeLog(manual ? '手动检查更新…' : '正在检查更新…');
  try {
    const result = await autoUpdater.checkForUpdates();
    // no update available → tell the user (both the return-value path and the
    // event path can fire; guard so we only show the dialog once)
    if ((!result || !result.updateInfo) && manual && mainWindow && isManualCheck) {
      isManualCheck = false;
      setUpdateState({ phase: 'idle', message: '' });
      writeLog('已是最新版本');
      dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: '已是最新版本', detail: `当前版本 v${CURRENT_VERSION}`, icon: path.join(__dirname, 'icon-256.png') });
    }
  } catch (e) {
    setUpdateState({ phase: 'error', message: e.message });
    writeLog('自动更新检查失败: ' + e.message);
    if (manual && mainWindow) {
      isManualCheck = false;
      dialog.showMessageBox(mainWindow, { type: 'error', title: '检查更新失败', message: '无法连接更新服务器', detail: String(e.message || e), buttons: ['前往下载页', '关闭'], defaultId: 0, cancelId: 1, icon: path.join(__dirname, 'icon-256.png') })
        .then(({ response }) => { if (response === 0) shell.openExternal(RELEASE_URL); });
    } else {
      checkViaGitHubApi(); // silent fallback: open the release page
    }
  }
}

// Fallback: if electron-updater fails, at least offer the download page
async function checkViaGitHubApi() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'tiktok-shop-creator-scraper', 'Accept': 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const rel = await res.json();
    const latestTag = (rel.tag_name || '').replace(/^v/i, '');
    if (!latestTag || !isNewer(latestTag, CURRENT_VERSION)) return;
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${latestTag}（自动更新不可用）`,
      detail: `当前版本：v${CURRENT_VERSION}\n\n请前往下载页获取新版安装包，覆盖安装即可保留原数据。`,
      buttons: ['前往下载', '稍后提醒'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(__dirname, 'icon-256.png'),
    });
    if (response === 0) shell.openExternal(RELEASE_URL);
  } catch (e) { writeLog('版本检查失败: ' + e.message); }
}

// wire autoUpdater events (called once at startup)
function setupAutoUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ phase: 'checking', percent: 0, message: '' });
    writeLog('正在检查更新…');
  });
  autoUpdater.on('update-available', async (info) => {
    const v = (info && info.version) || '';
    setUpdateState({ phase: 'available', percent: 0, message: `发现新版本 v${v}` });
    writeLog(`发现新版本 v${v}`);
    // fetch release notes from GitHub for EVERY version newer than the current
    // one, so users who skipped several releases see all the changes
    const stripMd = (body) => String(body || '')
      .replace(/^#+\s*/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim();
    let notes = '';
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
        headers: { 'User-Agent': 'tiktok-shop-creator-scraper', 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const rels = await res.json();
        // keep only versions newer than the current one
        const newer = (Array.isArray(rels) ? rels : [])
          .filter(r => r && !r.draft && !r.prerelease && isNewer((r.tag_name || '').replace(/^v/i, ''), CURRENT_VERSION))
          .sort((a, b) => {
            const av = parseVersion(a.tag_name), bv = parseVersion(b.tag_name);
            return (av[0] - bv[0]) || (av[1] - bv[1]) || (av[2] - bv[2]); // oldest first
          });
        notes = newer.map(r => {
          const body = stripMd(r.body);
          const tag = (r.tag_name || '').replace(/^v/i, '');
          return body ? `── v${tag} ──\n${body}` : '';
        }).filter(Boolean).join('\n\n');
      }
    } catch (e) { }
    // fallback: single latest release (e.g. API failed, list empty)
    if (!notes) {
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { 'User-Agent': 'tiktok-shop-creator-scraper', 'Accept': 'application/vnd.github+json' },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const rel = await res.json();
          if (rel && rel.body) notes = stripMd(rel.body);
        }
      } catch (e) { }
    }
    // show the update dialog in the renderer (scrollable, full notes) instead of
    // the native message box (no scrolling, notes were truncated before)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-update-dialog', {
        version: v,
        currentVersion: CURRENT_VERSION,
        notes: notes,
      });
    }
  });
  autoUpdater.on('download-progress', (p) => {
    const pct = p && p.percent != null ? Math.round(p.percent) : 0;
    setUpdateState({ phase: 'downloading', percent: pct, message: `正在下载更新 ${pct}%` });
    writeLog(`正在下载更新… ${pct}%`);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const v = (info && info.version) || '';
    setUpdateState({ phase: 'downloaded', percent: 100, message: '更新已下载完成' });
    writeLog('更新下载完成');
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已就绪',
      message: `v${v} 更新下载完成（当前 v${CURRENT_VERSION}）`,
      detail: runner.running
        ? '检测到正在抓取任务。\n\n你可以继续使用：选择「继续使用」后，抓取不受影响，下次退出应用时会自动完成更新安装。'
        : '重启后自动完成安装（通常需要1-2分钟）。',
      buttons: runner.running ? ['继续使用（退出时自动安装）', '立即重启安装'] : ['立即重启安装', '继续使用（退出时安装）'],
      defaultId: runner.running ? 0 : 0,
      cancelId: 1,
      icon: path.join(__dirname, 'icon-256.png'),
    });
    if (response === 0 && !runner.running) {
      // user chose immediate restart (and no scrape is running)
      setUpdateState({ phase: 'installing', percent: 100, message: '正在静默安装更新…' });
      // Stop any running scrape + close browsers first so the app can exit cleanly
      // and the silent installer never hits "cannot be closed".
      try { runner.stop(); } catch (e) { }
      try {
        for (const s of runner.sessions || []) {
          if (s.browser) { try { await Promise.race([s.browser.close(), new Promise(r => setTimeout(r, 3000))]).catch(() => { }); } catch (e) { } }
        }
      } catch (e) { }
      // quitAndInstall(true) => silent NSIS update: no license/dir UI, just replace files
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    } else {
      // "继续使用" (or scrape in progress): keep running; the update installs
      // automatically when the user quits the app (autoInstallOnAppQuit = true).
      setUpdateState({ phase: 'downloaded', percent: 100, message: '更新已就绪，退出应用时自动安装' });
      writeLog('更新已就绪：继续使用，退出应用时将自动完成安装。');
    }
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateState({ phase: 'idle', message: '' });
    writeLog('已是最新版本');
    // manual check → confirm to the user with a dialog
    if (isManualCheck && mainWindow) {
      isManualCheck = false;
      dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: '已是最新版本', detail: `当前版本 v${CURRENT_VERSION}`, icon: path.join(__dirname, 'icon-256.png') });
    }
  });
  autoUpdater.on('error', (e) => {
    setUpdateState({ phase: 'error', message: e && e.message || String(e) });
    writeLog('自动更新出错: ' + (e && e.message || e));
  });
}

// ---- desktop shortcut (default: create on first run) ----
function createDesktopShortcut() {
  try {
    const exePath = process.execPath;
    const desktop = path.join(os.homedir(), 'Desktop');
    const lnk = path.join(desktop, 'TikTokShop达人抓取.lnk');
    if (fs.existsSync(lnk)) return; // already exists
    if (!fs.existsSync(desktop)) return;
    const ps = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}'); $s.TargetPath = '${exePath.replace(/'/g, "''")}'; $s.WorkingDirectory = '${path.dirname(exePath).replace(/'/g, "''")}'; $s.IconLocation = '${exePath.replace(/'/g, "''")},0'; $s.Description = 'TikTokShop达人抓取工具'; $s.Save()`;
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => { });
    writeLog('已在桌面创建快捷方式');
  } catch (e) { writeLog('创建快捷方式失败: ' + e.message); }
}

// IPC: choose output directory (native dialog)
ipcMain.handle('choose-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return '';
  return result.filePaths[0];
});

// IPC: pick an import file (CSV/XLSX)
ipcMain.handle('choose-file', async (event, exts) => {
  const filters = Array.isArray(exts) && exts.length
    ? exts.map(e => ({ name: e.toUpperCase(), extensions: [e.replace(/^\./, '')] }))
    : [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要导入的达人数据文件',
    properties: ['openFile'],
    filters,
  });
  if (result.canceled || !result.filePaths.length) return '';
  return result.filePaths[0];
});

// IPC: get common directories
ipcMain.handle('common-dirs', async () => {
  const dirs = [];
  const home = os.homedir();
  dirs.push(path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads'), home, 'D:\\', 'E:\\');
  return dirs.filter(d => { try { return fs.existsSync(d); } catch (e) { return false; } });
});

// helper: save pasted cookie strings to temp files, return array of paths
function saveCookiesToFiles(pasted) {
  const cookieFiles = [];
  for (let i = 0; i < pasted.length; i++) {
    const txt = String(pasted[i]).replace(/^\uFEFF/, '').trim();
    let arr;
    try { arr = JSON.parse(txt); if (!Array.isArray(arr)) throw new Error('not array'); }
    catch (e) { return { error: `第 ${i + 1} 个粘贴 Cookie 不是有效 JSON 数组` }; }
    const f = path.join(os.tmpdir(), `tiktok-cookie-${Date.now()}-${i}.json`);
    fs.writeFileSync(f, JSON.stringify(arr));
    cookieFiles.push(f);
  }
  return { cookieFiles };
}

// IPC: test scrape with isolated environment (1 keyword, 1 page) to verify everything works
ipcMain.handle('test-scrape', async (event, config) => {
  if (runner.running) return { error: '抓取进行中，请稍后再试' };
  try {
    const pasted = config.pastedCookies || [];
    const { cookieFiles, error } = saveCookiesToFiles(pasted);
    if (error) return { error };
    if (!cookieFiles.length) return { error: '未收到 Cookie' };
    // isolated test: 1 cookie session, 1 keyword, page 0 only
    const cfg = {
      cookieFiles: cookieFiles.slice(0, 1),
      mode: config.mode || 'auto',
      format: config.format || 'csv',
      outPath: config.outPath || OUT_DIR,
      detail: false,
      shopRegion: config.shopRegion || 'US',
      keywords: ['phone case'],
      fields: ['handle', 'nickname'],
      testMode: true, // multirunner will stop after 1 page
    };
    const prevResult = runner.result;
    taskSupervisor.start('tiktok_shop', cfg).catch(e => runner.log('测试错误: ' + e.message));
    // wait for result
    for (let i = 0; i < 40; i++) { // up to ~3 min
      await new Promise(r => setTimeout(r, 5000));
      if (runner.result !== prevResult && runner.result) break;
    }
    const res = runner.result;
    if (res && res.ok) return { ok: true, rows: res.rows, creators: res.creators, log: runner.logs.slice(-8) };
    if (res && !res.ok) return { error: res.error, log: runner.logs.slice(-8) };
    return { error: '测试超时', log: runner.logs.slice(-8) };
  } catch (e) {
    return { error: e.message };
  }
});

// IPC: start scrape (cookies as array of JSON strings)
ipcMain.handle('start-scrape', async (event, config) => {
  if (runner.running) return { error: '已在运行中' };
  try {
    const pasted = config.pastedCookies || [];
    const { cookieFiles, error } = saveCookiesToFiles(pasted);
    if (error) return { error };
    if (!cookieFiles.length) return { error: '未收到 Cookie' };
    const cfg = {
      cookieFiles,
      mode: config.mode || 'auto',
      format: config.format || 'csv',
      outPath: path.isAbsolute(config.outPath || '') ? config.outPath : path.join(APP_DIR, config.outPath || 'output'),
      detail: !!config.detail,
      headerLang: config.headerLang === 'en' ? 'en' : 'zh',
      shopRegion: config.shopRegion || 'US',
      dedupe: !!config.dedupe,
      creatorInput: Array.isArray(config.creatorInput) ? config.creatorInput : null,
      keywords: config.keywords && config.keywords.length ? config.keywords : require('./lib/exporter').DEFAULT_KEYWORDS,
      fields: config.fields && config.fields.length ? config.fields : null,
      updateFields: config.updateFields && config.updateFields.length ? config.updateFields : null,
      libraryUpdate: !!config.libraryUpdate,
      libraryContinue: !!config.libraryContinue,
      autoExport: config.autoExport === false ? false : true, // scrape page: library only, no auto CSV
      existingIds: Array.isArray(config.existingIds) ? config.existingIds : null,
    };
    if (creatorDb) {
      // In "new only" mode, seed the runner's network-level dedupe set from
      // the canonical database instead of relying only on legacy JSON files.
      if (cfg.dedupe) cfg.existingIds = await creatorDb.getCreatorIds(cfg.shopRegion);
      cfg.databaseJobId = await creatorDb.createScrapeJob(cfg);
      runner._currentJobId = cfg.databaseJobId;
    }
    // remember the scrape configuration so the Creator Library can offer
    // "Continue scraping" with the same keywords/region later
    appData.lastScrapeConfig = {
      keywords: cfg.keywords || [],
      shopRegion: cfg.shopRegion || 'US',
      detail: !!cfg.detail,
      mode: cfg.mode || 'auto',
      format: cfg.format || 'csv',
    };
    saveAppData();
    // remember cookies for next launch
    appData.cookies = pasted.slice();
    saveAppData();
    const prevResult = runner.result;
    // attach the run config to the result so history can offer continue/refresh
    runner._lastConfig = cfg;
    taskSupervisor.start('tiktok_shop', cfg).catch(e => runner.log('内部错误: ' + e.message));
    // history is recorded via runner.onDone (reliable); this polling loop only
    // acts as a fallback trigger if onDone somehow didn't fire
    (async () => {
      for (let i = 0; i < 720; i++) { // up to ~60min
        await new Promise(r => setTimeout(r, 5000));
        if (runner.result !== prevResult && runner.result) {
          if (runner.result.ok && !runner._historyRecorded) recordHistory(runner.result);
          break;
        }
      }
    })();
    return { ok: true, sessions: cookieFiles.length };
  } catch (e) {
    return { error: e.message };
  }
});

// IPC: status
ipcMain.handle('scrape-status', () => {
  // cumulative total across sessions + rolling speed (creators/minute) + phase
  const ci = runner.updateRateInfo();
  return {
    running: runner.running,
    paused: runner.paused,
    stopping: !!(runner.running && runner.stopped),
    status: runner.status,
    currentInfo: ci,
    logs: runner.logs,
    result: runner.result,
    rateLimit: runner.rateLimit,
    autoResumeAt: runner.autoResumeAt || null, // for the auto-continue countdown UI
    update: updateState,
  };
});

// IPC: pause
ipcMain.handle('pause-scrape', () => {
  // The legacy IPC contract treats controls issued while idle as harmless.
  try { taskSupervisor.pause(); } catch (e) { if (e.code !== 'NO_ACTIVE_TASK') throw e; }
  return { ok: true };
});

function socialStateFile(platform, accountRef) {
  const state = resolvePlatformStateDirectory({
    stateRoot: path.join(app.getPath('userData'), 'collector-state'), platform, accountRef,
  });
  return { state, file: path.join(state.directory, platform === 'instagram' ? 'session.json' : 'accounts.sqlite') };
}

// Keep only a small, non-sensitive health signal next to a locally imported
// account. The renderer never receives cookie values, browser state, or a
// challenge URL; it only needs to tell the user whether an import must be
// refreshed before authenticated enrichment can continue.
function setSocialAccountSessionStatus(platform, accountRef, sessionStatus) {
  if (!platform || !accountRef || !sessionStatus) return;
  const account = (appData.socialAccounts || []).find(entry => entry.platform === platform && entry.accountRef === accountRef);
  if (!account) return;
  account.sessionStatus = sessionStatus;
  account.sessionStatusAt = new Date().toISOString();
  saveAppData();
}

function instagramCookieImportSummary(sourceText) {
  try {
    const parsed = JSON.parse(String(sourceText || '').replace(/^\uFEFF/, ''));
    const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;
    if (!Array.isArray(cookies)) return { cookieCount: 0, expiresAt: null };
    const expiries = cookies
      .map(cookie => Number(cookie?.expirationDate || cookie?.expires || 0))
      .filter(value => Number.isFinite(value) && value > 0);
    return { cookieCount: cookies.length, expiresAt: expiries.length ? new Date(Math.min(...expiries) * 1000).toISOString() : null };
  } catch (_) { return { cookieCount: 0, expiresAt: null }; }
}

ipcMain.handle('social-import-state', async (event, payload) => {
  const platform = payload?.platform;
  const source = typeof payload?.filePath === 'string' ? payload.filePath : '';
  if (!['instagram', 'x'].includes(platform) || !source || !credentialBroker) return { ok: false, error: 'SOCIAL_ACCOUNT_IMPORT_UNAVAILABLE' };
  try {
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) return { ok: false, error: 'SOCIAL_ACCOUNT_FILE_INVALID' };
    const reference = credentialBroker.write(platform, { importedState: true, importedAt: new Date().toISOString() });
    const { state, file } = socialStateFile(platform, reference.accountRef);
    fs.mkdirSync(state.directory, { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, file);
    appData.socialAccounts = (appData.socialAccounts || []).filter(entry => entry.platform !== platform || entry.accountRef !== reference.accountRef);
    appData.socialAccounts.push({ platform, accountRef: reference.accountRef, importedAt: new Date().toISOString(), sessionStatus: 'untested', sessionStatusAt: new Date().toISOString() });
    saveAppData();
    return { ok: true, platform, accountRef: reference.accountRef };
  } catch (_) { return { ok: false, error: 'SOCIAL_ACCOUNT_IMPORT_FAILED' }; }
});

// Browser Cookie exports are converted locally into the exact settings shape
// expected by instagrapi.  Raw cookies are never returned to the renderer,
// logged, or stored in appData.
ipcMain.handle('instagram-import-cookie-json', async (event, payload) => {
  const source = typeof payload?.filePath === 'string' ? payload.filePath : '';
  const pasted = typeof payload?.cookieText === 'string' ? payload.cookieText : '';
  if ((!source && !pasted) || !credentialBroker) return { ok: false, error: 'INSTAGRAM_COOKIE_IMPORT_UNAVAILABLE' };
  try {
    if (source && pasted) return { ok: false, error: 'INSTAGRAM_COOKIE_IMPORT_AMBIGUOUS' };
    let sourceText = pasted;
    if (source) {
      const stat = fs.statSync(source);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return { ok: false, error: 'INSTAGRAM_COOKIE_FILE_INVALID' };
      sourceText = fs.readFileSync(source, 'utf8');
    }
    const settings = convertInstagramCookieExport(sourceText);
    const reference = credentialBroker.write('instagram', { importedState: true, importedFrom: 'cookie-json', importedAt: new Date().toISOString() });
    const { state, file } = socialStateFile('instagram', reference.accountRef);
    fs.mkdirSync(state.directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 });
    appData.socialAccounts = (appData.socialAccounts || []).filter(entry => entry.platform !== 'instagram' || entry.accountRef !== reference.accountRef);
    appData.socialAccounts.push({ platform: 'instagram', accountRef: reference.accountRef, importedAt: new Date().toISOString(), sessionStatus: 'untested', sessionStatusAt: new Date().toISOString(), ...instagramCookieImportSummary(sourceText) });
    saveAppData();
    return { ok: true, platform: 'instagram', accountRef: reference.accountRef };
  } catch (error) {
    if (error instanceof InstagramCookieImportError) return { ok: false, error: error.code };
    return { ok: false, error: 'INSTAGRAM_COOKIE_IMPORT_FAILED' };
  }
});

ipcMain.handle('social-accounts', () => ({
  ok: true,
  accounts: (appData.socialAccounts || []).map(({ platform, accountRef, importedAt, cookieCount, expiresAt, sessionStatus, sessionStatusAt }) => {
    // A known past expiry is actionable even before the next browser request.
    // Do not overwrite persisted history here; just present the safer state.
    const expiryMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const effectiveStatus = platform === 'instagram' && Number.isFinite(expiryMs) && expiryMs <= Date.now()
      ? 'needs_reimport'
      : (sessionStatus || 'untested');
    return { platform, accountRef, importedAt, cookieCount, expiresAt, sessionStatus: effectiveStatus, sessionStatusAt };
  }),
}));

ipcMain.handle('social-remove-account', async (event, payload) => {
  const platform = payload?.platform;
  const accountRef = typeof payload?.accountRef === 'string' ? payload.accountRef : '';
  if (!['instagram', 'x'].includes(platform) || !accountRef) return { ok: false, error: 'SOCIAL_ACCOUNT_REMOVE_INVALID' };
  try {
    const { state } = socialStateFile(platform, accountRef);
    fs.rmSync(state.directory, { recursive: true, force: true });
    appData.socialAccounts = (appData.socialAccounts || []).filter(entry => entry.platform !== platform || entry.accountRef !== accountRef);
    saveAppData();
    return { ok: true };
  } catch (_) { return { ok: false, error: 'SOCIAL_ACCOUNT_REMOVE_FAILED' }; }
});

// Hiker is an optional paid enrichment provider. Its API key is stored only
// through the encrypted credential broker; renderer processes receive the
// configured flag and never the key itself.
ipcMain.handle('instagram-hiker-status', () => ({ ok: true, configured: Boolean(appData.instagramHiker?.accountRef && credentialBroker) }));
ipcMain.handle('instagram-hiker-configure', async (event, payload) => {
  const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (!credentialBroker || apiKey.length < 8 || apiKey.length > 512) return { ok: false, error: 'HIKER_API_KEY_INVALID' };
  try {
    const previous = appData.instagramHiker?.accountRef;
    const reference = credentialBroker.write('hiker_api', { apiKey, configuredAt: new Date().toISOString() });
    appData.instagramHiker = { accountRef: reference.accountRef, configuredAt: new Date().toISOString() };
    if (previous) credentialBroker.delete('hiker_api', previous);
    saveAppData();
    return { ok: true, configured: true };
  } catch (_) { return { ok: false, error: 'HIKER_CONFIGURATION_FAILED' }; }
});
ipcMain.handle('instagram-hiker-clear', async () => {
  try {
    const reference = appData.instagramHiker?.accountRef;
    if (reference && credentialBroker) credentialBroker.delete('hiker_api', reference);
    delete appData.instagramHiker;
    saveAppData();
    return { ok: true };
  } catch (_) { return { ok: false, error: 'HIKER_CONFIGURATION_CLEAR_FAILED' }; }
});

ipcMain.handle('instagram-idle-coverage-status', () => {
  const config = instagramIdleCoverageConfig();
  return { ok: true, enabled: config.enabled, minIdleMinutes: config.minIdleMinutes, scheduler: instagramIdleScheduler?.getState() || config.scheduler };
});
ipcMain.handle('instagram-idle-coverage-configure', (event, payload) => {
  const enabled = payload?.enabled === true;
  const minIdleMinutes = Math.min(120, Math.max(5, Number(payload?.minIdleMinutes) || 15));
  const previous = instagramIdleCoverageConfig();
  appData.instagramIdleCoverage = { ...previous, enabled, minIdleMinutes };
  saveAppData();
  setupInstagramIdleCoverage();
  return { ok: true, enabled, minIdleMinutes };
});

ipcMain.handle('creator-db-run-social-collection', async (event, payload) => {
  const platform = payload?.platform;
  if (platform !== product.platformId) return { ok: false, error: 'WRONG_PRODUCT_PLATFORM' };
  const accountRef = typeof payload?.accountRef === 'string' ? payload.accountRef : '';
  const useHiker = platform === 'instagram' && payload?.provider === 'hiker';
  const useAnonymousInstagramBrowser = platform === 'instagram' && payload?.provider === 'public_browser';
  const isInstagramAutomatic = platform === 'instagram' && payload?.mode === 'automatic';
  const usePublicInstagramDiscovery = platform === 'instagram' && payload?.mode === 'public_discovery';
  const useLocalInstagramSession = platform === 'instagram' && Boolean(accountRef) && !useHiker && !useAnonymousInstagramBrowser;
  // Public discovery and anonymous public-profile collection deliberately do
  // not use any credential/session state.  They must keep working even when
  // secure credential storage is unavailable or an imported session expired.
  const needsCredentialBroker = useLocalInstagramSession || useHiker || platform === 'x';
  if (!['instagram', 'x'].includes(platform) || (!accountRef && !useHiker && !useAnonymousInstagramBrowser && !isInstagramAutomatic && !usePublicInstagramDiscovery) || (needsCredentialBroker && !credentialBroker)) return { ok: false, error: 'SOCIAL_ACCOUNT_REQUIRED' };
  // A single imported Instagram session has one strictly serial browser lane.
  // Running two browser tasks against it does not increase reliable output and
  // makes throttling/session challenges substantially more likely. Other
  // platforms remain independently runnable.
  if (platform === 'instagram' && !instagramCollectionLane.tryAcquire()) return { ok: false, error: 'INSTAGRAM_COLLECTION_BUSY' };
  try {
    if (useLocalInstagramSession) assertInstagramAvailable(appData.instagramCooldown);
    const reportProgress = progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-progress', { platform, ...progress });
    };
    if (useHiker) {
      const hikerRef = appData.instagramHiker?.accountRef;
      if (!hikerRef) return { ok: false, error: 'HIKER_NOT_CONFIGURED' };
      const credentials = credentialBroker.read('hiker_api', hikerRef);
      const result = await runHikerInstagramProfileEnrichment({
        apiKey: credentials.apiKey, handles: payload?.handles, databaseManager: creatorDbManager,
        onProgress: reportProgress,
        discoveryMetadata: discoveryMetadata({ mode: 'custom', keyword: '', category: payload?.keywordCategory || '', source: 'hiker_profile_enrichment' }),
      });
      delete appData.instagramCooldown;
      saveAppData();
      return result;
    }
    if (usePublicInstagramDiscovery || (isInstagramAutomatic && !accountRef)) {
      return await runInstagramPublicDiscovery({
        databaseManager: creatorDbManager, region: 'GLOBAL', maxResultsPerSeed: payload?.maxResultsPerSeed || 10, seedGapMs: 15 * 60_000,
        onProgress: reportProgress,
      });
    }
    if (useAnonymousInstagramBrowser) {
      return await runInstagramBrowserProfileCollection({
        databaseManager: creatorDbManager, region: 'GLOBAL', handles: payload?.handles,
        browserMode: payload?.browserMode,
        // An explicit empty Cookie array keeps this path independent from any
        // imported account. It reads only what a public browser page exposes.
        cookies: [],
        collectionSource: 'instagram_anonymous_browser_profile',
        onProgress: reportProgress,
        discoveryMetadata: discoveryMetadata({ mode: 'custom', keyword: '', category: payload?.keywordCategory || '', source: 'instagram_anonymous_browser_profile' }),
      });
    }
    credentialBroker.read(platform, accountRef);
    const { state, file } = socialStateFile(platform, accountRef);
    if (!fs.existsSync(file)) return { ok: false, error: 'SOCIAL_ACCOUNT_STATE_MISSING' };
    if (platform === 'instagram' && payload?.mode === 'automatic' && accountRef) {
      try {
        const result = await runInstagramHeadlessDiscovery({
          databaseManager: creatorDbManager, region: 'GLOBAL', sessionStatePath: file, stateRoot: state.root,
          maxResultsPerSeed: payload?.maxResultsPerSeed || 10,
          onProgress: reportProgress,
        });
        setSocialAccountSessionStatus('instagram', accountRef, 'ready');
        delete appData.instagramCooldown;
        saveAppData();
        return result;
      } catch (error) {
        if (error?.code !== 'INSTAGRAM_SESSION_ATTENTION_REQUIRED') throw error;
        // A login/checkpoint page means the local session needs user action,
        // but it does not prevent the candidate-only public discovery route
        // from continuing this task safely.
        setSocialAccountSessionStatus('instagram', accountRef, 'needs_reimport');
        reportProgress({ state: 'fallback_public_discovery', phase: 'session_attention', totalSeeds: 0, completedSeeds: 0 });
        const fallback = await runInstagramPublicDiscovery({
          databaseManager: creatorDbManager, region: 'GLOBAL', maxResultsPerSeed: payload?.maxResultsPerSeed || 10, seedGapMs: 15 * 60_000,
          onProgress: reportProgress,
        });
        return { ...fallback, sessionNeedsReimport: true, recoveryMode: 'public_candidate_discovery' };
      }
    }
    if (platform === 'instagram' && payload?.provider === 'browser') {
      const result = await runInstagramBrowserProfileCollection({
        databaseManager: creatorDbManager, region: 'GLOBAL', handles: payload?.handles,
        browserMode: payload?.browserMode, sessionStatePath: file, stateRoot: state.root,
        onProgress: reportProgress,
        discoveryMetadata: discoveryMetadata({ mode: 'custom', keyword: '', category: payload?.keywordCategory || '', source: 'instagram_browser_profile' }),
      });
      setSocialAccountSessionStatus('instagram', accountRef, 'ready');
      delete appData.instagramCooldown;
      saveAppData();
      return result;
    }
    const taskPayload = platform === 'instagram'
      ? { handles: payload?.handles, sessionStatePath: file, requestDelaySeconds: 4 }
      : { query: payload?.query, maxResults: payload?.maxResults };
    const result = await runLocalPythonCollection({
      platformId: platform, databaseManager: creatorDbManager, region: 'GLOBAL', payload: taskPayload,
      discoveryMetadata: discoveryMetadata({
        mode: 'custom', keyword: platform === 'instagram' ? '' : payload?.query,
        category: payload?.keywordCategory || '', source: platform === 'instagram' ? 'user_handle_list' : 'user',
      }),
      brokerRef: platform === 'x' ? file : undefined,
      env: { ...process.env, COLLECTOR_STATE_ROOT: state.root, TWS_TELEMETRY: '0' },
      runtimeOptions: { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
      onProgress: reportProgress,
    });
    if (platform === 'instagram') { delete appData.instagramCooldown; saveAppData(); }
    if (platform === 'instagram') setSocialAccountSessionStatus('instagram', accountRef, 'ready');
    return result;
  } catch (error) {
    if (platform === 'instagram') {
      if (error?.code === 'INSTAGRAM_SESSION_ATTENTION_REQUIRED') setSocialAccountSessionStatus('instagram', accountRef, 'needs_reimport');
      // Public no-Cookie discovery has no local session to repair. A search
      // verification page is surfaced to the UI with a safe cooldown instead
      // of inviting the user to repeatedly start the same task.
      if (error?.code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED') error.retryAt = Date.now() + 2 * 60 * 60_000;
      const cooldown = useLocalInstagramSession ? nextInstagramCooldown(error) : null;
      if (cooldown) { appData.instagramCooldown = cooldown; saveAppData(); }
      return { ok: false, error: error.code || 'SOCIAL_COLLECTION_FAILED', retryAt: cooldown?.retryAt || error.retryAt || null, stage: error.stage || null };
    }
    return { ok: false, error: error.code || 'SOCIAL_COLLECTION_FAILED' };
  } finally { if (platform === 'instagram') instagramCollectionLane.release(); }
});

// IPC: resume (refresh session pages first so any captcha/error page is cleared)
ipcMain.handle('resume-scrape', async () => {
  try { await taskSupervisor.resumeWithRefresh(); } catch (e) { if (e.code !== 'NO_ACTIVE_TASK' && e.code !== 'TASK_NOT_PAUSED') throw e; }
  return { ok: true };
});

// IPC: stop
ipcMain.handle('stop-scrape', () => {
  try { taskSupervisor.stop(); } catch (e) { if (e.code !== 'NO_ACTIVE_TASK') throw e; }
  return { ok: true };
});

// IPC: exit app
ipcMain.handle('exit-app', () => {
  // Route through the window close flow so the save-or-quit confirm applies
  // to the Exit button exactly like the window X.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  else app.quit();
  return { ok: true };
});

// Single instance: only one copy of the app may run at a time
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    loadAppData();
    // always ensure dirs + shortcut on every launch (idempotent)
    ensureDirs();
    openLogStream();
    initializeCredentialBroker();
    writeLog('应用启动: ' + APP_DIR);
    try {
      creatorDbManager = new PlatformDatabaseManager(path.join(app.getPath('userData'), 'data'));
      creatorDb = await creatorDbManager.getDatabase('tiktok_shop');
      writeLog('本地达人库就绪: ' + creatorDb.filePath);
    } catch (e) {
      creatorDb = null;
      creatorDbManager = null;
      writeLog('本地达人库初始化失败，继续使用文件模式: ' + e.message);
    }
    createWindow();
    setupInstagramIdleCoverage();
    createDesktopShortcut(); // skips if shortcut already exists
    // auto-update: wire events once, then check after window is ready
    setupAutoUpdaterEvents();
    setTimeout(() => checkForUpdates(), 5000);
  });
  app.on('window-all-closed', () => {
    // clean up scrape browsers so the on-quit auto-update install never hits
    // "app cannot be closed" (files would be locked by the running Chrome)
    try {
      for (const s of runner.sessions || []) {
        if (s.browser) { try { Promise.race([s.browser.close(), new Promise(r => setTimeout(r, 2000))]).catch(() => { }); } catch (e) { } }
      }
    } catch (e) { }
    instagramIdleScheduler?.stop();
    if (creatorDbManager) creatorDbManager.closeAll().catch(() => { });
    app.quit();
  });
}
