'use strict';
// Opt-in public release download/reconstruction test. NEVER executes an installer,
// loads main.js, accesses the real updater cache, or registers quitAndInstall.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const yaml = require('js-yaml');

function emit(value) { process.stdout.write('UPDATE_VERIFY ' + JSON.stringify(value) + '\n'); }
process.stdout.on('error', error => { if (error.code !== 'EPIPE') throw error; });

if (!process.versions.electron) {
  const [flag, oldVersion, newVersion] = process.argv.slice(2);
  assert.equal(flag, '--live', 'Opt in: node scripts/verify-incremental-update.js --live 1.3.1 1.4.0');
  for (const version of [oldVersion, newVersion]) assert(/^\d+\.\d+\.\d+$/.test(version || ''), 'Use stable x.y.z versions');
  assert.notEqual(oldVersion, newVersion);
  const root = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'incremental-update-'));
  const exe = require('electron');
  assert(!fs.existsSync(path.join(path.dirname(exe), 'resources/app.asar')),
    'Refusing bundled application executable: script arguments would not isolate it');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(exe, [__filename, '--worker', dir, oldVersion, newVersion],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for (const line of lines) if (line.startsWith('UPDATE_VERIFY ')) process.stdout.write(line + '\n');
  });
  // Electron diagnostics may contain redirects/local paths. Only emit structured results.
  child.stderr.resume();
  child.on('error', () => { emit({ status: 'failed', stage: 'launch' }); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
} else {
  assert.equal(process.argv[2], '--worker');
  const [dir, oldVersion, newVersion] = process.argv.slice(3);
  assert(path.dirname(path.resolve(dir)) === path.resolve(__dirname, '../test-results'));
  const { app } = require('electron');
  assert(!app.isPackaged, 'Stock Electron required');
  const userData = path.join(dir, 'isolated-user-data');
  fs.mkdirSync(userData);
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
  app.commandLine.appendSwitch('disable-background-networking');
  app.disableHardwareAcceleration();
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
  const { CancellationToken } = require('builder-util-runtime');
  const { createVerification, summarizePlan, CURRENT_APP_INSTALLER_FILE_NAME } = require('./update-verification-core');
  const startedAt = new Date().toISOString();
  let stage = 'metadata';
  let finished = false;
  const transport = { rangeResponses: 0, rangeBodyBytes: 0, non206RangeResponses: 0,
    redirects: 0, fullInstallerResponses: 0 };
  const maps = new Map();
  class MeasuredExecutor extends ElectronHttpExecutor {
    createRequest(options, callback) {
      const range = options.headers?.range || options.headers?.Range;
      const installer = /\.exe(?:\?|$)/.test(options.path || '');
      const request = super.createRequest(options, response => {
        if (range) {
          transport.rangeResponses++;
          if (response.statusCode !== 206) transport.non206RangeResponses++;
          response.on('data', bytes => { transport.rangeBodyBytes += bytes.length; });
        } else if (installer && response.statusCode === 200) transport.fullInstallerResponses++;
        callback(response);
      });
      request.on('redirect', () => { transport.redirects++; });
      return request;
    }
    async downloadToBuffer(url, options) {
      const bytes = await super.downloadToBuffer(url, options);
      if (url.pathname.endsWith('.blockmap')) maps.set(url.pathname, JSON.parse(zlib.gunzipSync(bytes)));
      return bytes;
    }
  }
  const executor = new MeasuredExecutor();
  const token = new CancellationToken();
  const repo = '1Milkdeliver/tiktok-shop-creator-scraper';
  async function downloadBuffer(url) {
    return executor.downloadToBuffer(new URL(url), { cancellationToken: token,
      headers: { 'User-Agent': 'creator-updater-verification' } });
  }
  async function metadata(version) {
    const release = JSON.parse(await downloadBuffer(`https://api.github.com/repos/${repo}/releases/tags/v${version}`));
    assert(!release.draft && !release.prerelease);
    const name = `tiktok-shop-creator-scraper-setup-${version}.exe`;
    const asset = release.assets.find(item => item.name === name);
    const manifestAsset = release.assets.find(item => item.name === 'latest.yml');
    assert(asset && manifestAsset, 'Canonical installer and manifest required');
    const manifest = yaml.load((await downloadBuffer(manifestAsset.browser_download_url)).toString());
    assert.equal(manifest.version, version);
    assert.equal(manifest.path, name);
    const info = manifest.files.find(item => item.url === name);
    assert(info && info.sha512 && info.size === asset.size);
    assert.equal(info.sha512, manifest.sha512);
    assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest || ''), 'Published asset SHA-256 required');
    assert.equal(asset.browser_download_url, `https://github.com/${repo}/releases/download/v${version}/${name}`);
    return { version, info, url: new URL(asset.browser_download_url), sha256: asset.digest.slice(7) };
  }
  function verifyFile(file, meta) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, meta.info.size);
    assert.equal(crypto.createHash('sha512').update(bytes).digest('base64'), meta.info.sha512);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), meta.sha256);
  }
  function finish(error, result) {
    if (finished) return;
    finished = true;
    const report = { status: error ? 'failed' : 'passed', stage, startedAt,
      finishedAt: new Date().toISOString(), oldVersion, newVersion,
      updaterVersion: require('electron-updater/package.json').version, electron: process.versions.electron,
      ...result, ...(error ? { errorCode: String(error.code || error.name),
        failure: String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 600) } : {}),
      installerExecuted: false, applicationLoaded: false, productionCacheAccessed: false,
      livePlatformCollection: false };
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
    emit({ ...report, resultDirectory: dir });
    setTimeout(() => app.exit(error ? 1 : 0), 250);
  }
  process.on('uncaughtException', error => finish(error));
  process.on('unhandledRejection', error => finish(error));
  setTimeout(() => { token.cancel(); finish(new Error('Verification exceeded 15 minute limit')); }, 15 * 60 * 1000).unref();
  app.whenReady().then(async () => {
    emit({ status: 'running', stage, oldVersion, newVersion });
    const oldMeta = await metadata(oldVersion);
    const newMeta = await metadata(newVersion);
    const cacheDir = path.join(dir, 'cache');
    const pendingDir = path.join(dir, 'pending');
    fs.mkdirSync(cacheDir); fs.mkdirSync(pendingDir);
    stage = 'download-old-base';
    emit({ status: 'running', stage, bytes: oldMeta.info.size });
    const oldFile = path.join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME);
    await executor.download(oldMeta.url, oldFile, { cancellationToken: token, sha512: oldMeta.info.sha512 });
    verifyFile(oldFile, oldMeta);
    stage = 'differential-download';
    emit({ status: 'running', stage });
    Object.keys(transport).forEach(key => { transport[key] = 0; });
    const differentialStarted = Date.now();
    let lastProgress = 0;
    const verification = createVerification({ executor, cacheDir, pendingDir, oldVersion, newVersion,
      fileInfo: { url: newMeta.url, info: newMeta.info }, onProgress: progress => {
        if (Date.now() - lastProgress > 15000) {
          lastProgress = Date.now();
          emit({ status: 'running', stage, downloadedBytes: progress.transferred, downloadTotal: progress.total });
        }
      } });
    const outputFile = path.join(pendingDir, `reconstructed-${newVersion}.exe`);
    assert.equal(await verification.differential(outputFile), false, 'Full fallback must not pass a differential test');
    const differentialElapsedMs = Date.now() - differentialStarted;
    const [oldMapUrl, newMapUrl] = verification.provider.getBlockMapFiles(newMeta.url, oldVersion, newVersion);
    const plan = summarizePlan(maps.get(oldMapUrl.pathname), maps.get(newMapUrl.pathname));
    assert.equal(plan.newInstallerBytes, newMeta.info.size);
    assert.equal(transport.rangeBodyBytes, plan.downloadBytes);
    assert.equal(transport.rangeResponses, plan.rangeOperationCount);
    assert.equal(transport.non206RangeResponses, 0);
    assert.equal(transport.fullInstallerResponses, 0);
    stage = 'verify-reconstructed-installer';
    verifyFile(outputFile, newMeta);
    finish(null, { ...plan, transport, differentialElapsedMs,
      sha512MatchesManifest: true, sha256MatchesPublishedAsset: true,
      reconstructedSha256: newMeta.sha256, oldBaseHashVerified: true,
      oldBlockmapDownloadedFromRelease: true, fullDownloadFallbackUsed: false });
  }).catch(error => finish(error));
}
