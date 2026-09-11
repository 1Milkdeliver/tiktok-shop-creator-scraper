'use strict';
// Load the packaged main/preload/renderer in a hidden, offline, isolated test instance.
// Shell actions, downloads and external navigation are not exercised here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

if (!process.versions.electron) {
  const appDir = path.resolve(process.argv[2] || '');
  const archive = path.join(appDir, 'resources', 'app.asar');
  assert(fs.existsSync(archive), 'Pass a packaged app directory');
  // A packaged executable ignores a JS argument and starts its bundled app.
  // Use the same-version stock runtime so isolation is installed BEFORE main.js.
  const exe = require('electron');
  assert(!fs.existsSync(path.join(path.dirname(exe), 'resources', 'app.asar')),
    'Refusing a bundled-app runtime: it would bypass the isolation harness');
  assert.equal(require('electron/package.json').version, require('../package.json').devDependencies.electron);
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(exe, [__filename, appDir], { env, windowsHide: true,
    encoding: 'utf8', timeout: 30000 });
  if (result.error) throw new Error(result.error.message + '\n' + result.stderr);
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('COMPAT_RESULT '));
  assert(line, 'Startup probe returned no result');
  console.log(line.slice('COMPAT_RESULT '.length));
} else {
  const electron = require('electron');
  const { app, BrowserWindow, session } = electron;
  const { EventEmitter } = require('node:events');
  const { Module, createRequire } = require('node:module');
  const archive = path.join(path.resolve(process.argv[2]), 'resources', 'app.asar');
  assert.equal(process.versions.electron, require('../package.json').devDependencies.electron);
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-startup-compat-'));
  const userData = path.join(fixtureDir, 'userData');
  fs.mkdirSync(userData);
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('disable-background-networking');
  let report;
  let failure;
  let probeWindow;
  const finish = (error, result) => {
    failure = error;
    report = result;
    if (probeWindow && !probeWindow.isDestroyed()) probeWindow.destroy();
    setTimeout(() => app.exit(error ? 1 : 0), 1000).unref();
  };
  process.on('uncaughtException', error => finish(error));
  process.on('unhandledRejection', error => finish(error));
  process.on('exit', () => {
    if (failure) process.stderr.write('Startup compatibility failed: ' + failure.message + '\n');
    if (report) process.stdout.write('COMPAT_RESULT ' + JSON.stringify(report) + '\n');
  });
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(file|data|devtools):/.test(details.url) });
    });
    const updater = new EventEmitter();
    updater.checkForUpdates = async () => null;
    updater.downloadUpdate = async () => { throw new Error('Downloads disabled in fixture'); };
    const shell = { ...electron.shell,
      openExternal: () => { throw new Error('External links disabled in fixture'); } };
    const WrappedWindow = function (options) {
      probeWindow = new BrowserWindow({ ...options, show: false });
      const loadFile = probeWindow.loadFile.bind(probeWindow);
      probeWindow.loadFile = file => loadFile(path.join(archive, file));
      probeWindow.webContents.on('preload-error', (_event, _file, error) => finish(error));
      probeWindow.webContents.once('did-finish-load', async () => {
        try {
          const result = await probeWindow.webContents.executeJavaScript(`(async () => {
            if (typeof window.api?.getVersion !== 'function') throw new Error('Preload API missing');
            const version = await window.api.getVersion();
            const stats = await window.api.creatorDbStats();
            if (!stats.ok || stats.creators !== 0) throw new Error('Isolated database not ready');
            document.querySelector('[data-page="creators"]').click();
            const filtered = await window.api.listCreators({hasEmail:true,hasWhatsapp:true});
            if (!filtered.ok || filtered.total !== 0) throw new Error('Contact filter IPC failed');
            const status = await window.api.partnerContactsStatus();
            if (!document.getElementById('autoContacts')?.checked) throw new Error('Automatic contacts option missing');
            if (!document.getElementById('taskContactOpen') || !document.getElementById('taskContactProgress')) throw new Error('Task contact controls missing');
            if (status.connected || status.automatic?.outcome !== 'idle') throw new Error('Unexpected contact state in empty fixture');
            if (!document.getElementById('accounts').contains(document.getElementById('contactImport'))) throw new Error('Partner import must be in account management');
            if (document.getElementById('contactPanel').contains(document.getElementById('contactImport'))) throw new Error('Duplicate Partner import');
            const country = document.getElementById('creatorContinueRegion');
            if (!country || ![...country.options].some(o=>o.value==='MY')) throw new Error('Continue country control missing');
            for (const id of ['shopRegion','contactRegion','partnerAccountCountry','creatorContinueRegion'])
              for (const region of ['MY','US','JP','DE','IE','HU'])
                if (![...document.getElementById(id).options].some(o=>o.value===region)) throw new Error('Missing market in '+id);
            if (document.getElementById('discoverySource')?.value !== 'auto') throw new Error('Discovery source control missing');
            openAccountSettings();
            document.getElementById('cookieCountry').value='MY';
            document.getElementById('cookieName').value='Synthetic MY account';
            await addCookie('paste', JSON.stringify([{name:'sessionid',value:'synthetic-only',domain:'.example.test'}]));
            const saved = await window.api.getAppData();
            if (saved.accountEntries?.[0]?.region !== 'MY' || saved.accountEntries[0].name !== 'Synthetic MY account') throw new Error('Account metadata was not persisted');
            if (!document.querySelector('.account-name') || document.querySelector('.account-country').value !== 'MY') throw new Error('Account editing controls missing');
            if (document.getElementById('cookieList').textContent.includes('synthetic-only')) throw new Error('Session token exposed in account list');
            await saveCookieEntries([]);
            await refreshAppData();
            if (cookieList.length) throw new Error('Deleted fixture account reappeared');
            return {version:version.version,preloadIPC:true,databaseReady:true,creatorNavigation:true,
              accountMetadataIPC:true,accountCountryControls:true,partnerImportMoved:true,
              contactFilterIPC:true,contactStatusIPC:!!status,automaticContactControls:true,rendererTitle:document.title};
          })()`);
          assert.equal(result.version, JSON.parse(fs.readFileSync(path.join(archive, 'package.json'))).version);
          finish(null, { ...result, electron: process.versions.electron, productionDataAccessed: false,
            visibleWindowOpened: false, liveCollectionTested: false });
        } catch (error) { finish(error); }
      });
      return probeWindow;
    };
    const mainFile = path.join(archive, 'main.js');
    const localRequire = createRequire(mainFile);
    const testedModule = new Module(mainFile);
    testedModule.filename = mainFile;
    testedModule.paths = Module._nodeModulePaths(archive);
    testedModule.require = name => {
      if (name === 'electron') return { ...electron, BrowserWindow: WrappedWindow, shell };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === 'os') return { ...os, homedir: () => fixtureDir };
      return localRequire(name);
    };
    global.fetch = async () => { throw new Error('Network disabled in startup fixture'); };
    testedModule._compile(fs.readFileSync(mainFile, 'utf8'), mainFile);
  }).catch(error => finish(error));
}
