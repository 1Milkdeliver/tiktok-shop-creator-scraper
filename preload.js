// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  commonDirs: () => ipcRenderer.invoke('common-dirs'),
  start: (cfg) => ipcRenderer.invoke('start-scrape', cfg),
  test: (cfg) => ipcRenderer.invoke('test-scrape', cfg),
  status: () => ipcRenderer.invoke('scrape-status'),
  pause: () => ipcRenderer.invoke('pause-scrape'),
  resume: () => ipcRenderer.invoke('resume-scrape'),
  stop: () => ipcRenderer.invoke('stop-scrape'),
  getAppData: () => ipcRenderer.invoke('get-app-data'),
  getLastScrapeConfig: () => ipcRenderer.invoke('get-last-scrape-config'),
  clearCookies: () => ipcRenderer.invoke('clear-cookies'),
  creatorDbStats: () => ipcRenderer.invoke('creator-db-stats'),
  listCreators: (filters) => ipcRenderer.invoke('creator-db-list', filters),
  listCreatorIds: (filters) => ipcRenderer.invoke('creator-db-ids', filters),
  creatorFilterOptions: (key) => ipcRenderer.invoke('creator-db-options', key),
  importCreators: (payload) => ipcRenderer.invoke('creator-db-import', payload),
  chooseFile: (exts) => ipcRenderer.invoke('choose-file', exts),
  listScrapeJobs: (filters) => ipcRenderer.invoke('creator-db-jobs', filters),
  exportCreators: (payload) => ipcRenderer.invoke('creator-db-export', payload),
  updateExportFile: (filePath) => ipcRenderer.invoke('update-export-file', filePath),
  openHistoryFile: (p) => ipcRenderer.invoke('open-history-file', p),
  copyHistoryPath: (p) => ipcRenderer.invoke('copy-history-path', p),
  openHistoryFolder: (p) => ipcRenderer.invoke('open-history-folder', p),
  deleteHistoryFile: (p) => ipcRenderer.invoke('delete-history-file', p),
  continueHistory: (p) => ipcRenderer.invoke('continue-history', p),
  refreshHistory: (p) => ipcRenderer.invoke('refresh-history', p),
  getVersion: () => ipcRenderer.invoke('get-version'),
  exit: () => ipcRenderer.invoke('exit-app'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
  onUpdateState: (cb) => ipcRenderer.on('update-state', (e, s) => cb(s)),
  onShowUpdateDialog: (cb) => ipcRenderer.on('show-update-dialog', (e, d) => cb(d)),
});

