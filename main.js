// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
// main.js — Electron main process: native window, native folder picker, scrape orchestration
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { MultiRunner } = require('./lib/multirunner');
const { CreatorDatabase } = require('./lib/database');

let mainWindow = null;
let creatorDb = null;
const runner = new MultiRunner();
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
    if (result && result.ok && !result.testMode) {
      runner._historyRecorded = true;
      // attach the run config so history entries can continue/refresh
      if (runner._lastConfig) result.config = runner._lastConfig;
      recordHistory(result);
    }
    runner._currentJobId = null;
  } catch (e) { }
};

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
let appData = { cookies: [], history: [], shortcutAsked: false, outDir: OUT_DIR };
function dataFile() { return path.join(app.getPath('userData'), 'app-data.json'); }

function loadAppData() {
  try {
    if (fs.existsSync(dataFile())) {
      appData = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
      if (!Array.isArray(appData.cookies)) appData.cookies = [];
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
    time: new Date().toLocaleString(),
    config: entry.config ? {
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
ipcMain.handle('clear-cookies', () => { appData.cookies = []; saveAppData(); return { ok: true }; });
ipcMain.handle('creator-db-stats', async () => {
  if (!creatorDb) return { error: '本地达人库未初始化' };
  try { return { ok: true, ...(await creatorDb.getStats()) }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('creator-db-list', async (event, filters) => {
  if (!creatorDb) return { error: '本地达人库未初始化', rows: [], total: 0 };
  try { return { ok: true, ...(await creatorDb.listCreators(filters || {})) }; }
  catch (e) { return { error: e.message, rows: [], total: 0 }; }
});
ipcMain.handle('creator-db-ids', async (event, filters) => {
  if (!creatorDb) return { error: '本地达人库未初始化', ids: [] };
  try { return { ok: true, ids: await creatorDb.listCreatorIds(filters || {}) }; }
  catch (e) { return { error: e.message, ids: [] }; }
});
ipcMain.handle('creator-db-jobs', async (event, filters) => {
  if (!creatorDb) return { error: '本地达人库未初始化', rows: [], total: 0 };
  try { return { ok: true, ...(await creatorDb.listScrapeJobs(filters || {})) }; }
  catch (e) { return { error: e.message, rows: [], total: 0 }; }
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
    runner.start(cfg).catch(e => runner.log('继续抓取错误: ' + e.message));
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
    runner.start(cfg).catch(e => runner.log('刷新抓取错误: ' + e.message));
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
    width: 980,
    height: 860,
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
    runner.start(cfg).catch(e => runner.log('测试错误: ' + e.message));
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
    };
    if (creatorDb) {
      // In "new only" mode, seed the runner's network-level dedupe set from
      // the canonical database instead of relying only on legacy JSON files.
      if (cfg.dedupe) cfg.existingIds = await creatorDb.getCreatorIds(cfg.shopRegion);
      cfg.databaseJobId = await creatorDb.createScrapeJob(cfg);
      runner._currentJobId = cfg.databaseJobId;
    }
    // remember cookies for next launch
    appData.cookies = pasted.slice();
    saveAppData();
    const prevResult = runner.result;
    // attach the run config to the result so history can offer continue/refresh
    runner._lastConfig = cfg;
    runner.start(cfg).catch(e => runner.log('内部错误: ' + e.message));
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
ipcMain.handle('scrape-status', () => ({
  running: runner.running,
  paused: runner.paused,
  stopping: !!(runner.running && runner.stopped),
  status: runner.status,
  currentInfo: runner.currentInfo || {},
  logs: runner.logs,
  result: runner.result,
  rateLimit: runner.rateLimit,
  autoResumeAt: runner.autoResumeAt || null, // for the auto-continue countdown UI
  update: updateState,
}));

// IPC: pause
ipcMain.handle('pause-scrape', () => { runner.pause(); return { ok: true }; });

// IPC: resume
ipcMain.handle('resume-scrape', () => { runner.resume(); return { ok: true }; });

// IPC: stop
ipcMain.handle('stop-scrape', () => { runner.stop(); return { ok: true }; });

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
    writeLog('应用启动: ' + APP_DIR);
    try {
      creatorDb = new CreatorDatabase(path.join(app.getPath('userData'), 'data', 'creators.db'));
      await creatorDb.open();
      writeLog('本地达人库就绪: ' + creatorDb.filePath);
    } catch (e) {
      creatorDb = null;
      writeLog('本地达人库初始化失败，继续使用文件模式: ' + e.message);
    }
    createWindow();
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
    if (creatorDb) creatorDb.close().catch(() => { });
    app.quit();
  });
}
