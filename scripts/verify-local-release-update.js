'use strict';
// Pre-publication reconstruction from real installer files over loopback HTTP.
// Never executes either installer or accesses the production updater cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const yaml = require('js-yaml');
const { HttpExecutor, configureRequestUrl, configureRequestOptions } = require('builder-util-runtime');
const { createVerification, summarizePlan, CURRENT_APP_INSTALLER_FILE_NAME } = require('./update-verification-core');

class LoopbackExecutor extends HttpExecutor {
  createRequest(options, callback) {
    assert.equal(options.hostname || options.host, '127.0.0.1');
    // Node's shared keep-alive agent retains upstream timeout listeners across
    // many fixture ranges. Production uses ElectronHttpExecutor, not this shim.
    return http.request({ ...options, agent: false }, callback);
  }
  download(url, destination, options) {
    return options.cancellationToken.createPromise((resolve, reject, onCancel) => {
      const requestOptions = { headers: options.headers };
      configureRequestUrl(url, requestOptions);
      configureRequestOptions(requestOptions);
      this.doDownload(requestOptions, { destination, options, onCancel, responseHandler: null,
        callback: error => error ? reject(error) : resolve(destination) }, 0);
    });
  }
}

function readRelease(directory) {
  const manifest = yaml.load(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'));
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Stable version required');
  const name = `tiktok-shop-creator-scraper-setup-${manifest.version}.exe`;
  assert.equal(manifest.path, name);
  const info = manifest.files.find(file => file.url === name);
  assert(info && info.sha512 === manifest.sha512);
  const installer = path.join(directory, name);
  const bytes = fs.readFileSync(installer);
  assert.equal(bytes.length, info.size);
  assert.equal(crypto.createHash('sha512').update(bytes).digest('base64'), info.sha512);
  const blockmapBytes = fs.readFileSync(installer + '.blockmap');
  return { version: manifest.version, name, info, installer, blockmapBytes,
    map: JSON.parse(zlib.gunzipSync(blockmapBytes)),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

(async () => {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/verify-local-release-update.js OLD_ASSETS NEW_ASSETS');
  const oldRelease = readRelease(path.resolve(process.argv[2]));
  const newRelease = readRelease(path.resolve(process.argv[3]));
  assert.notEqual(oldRelease.version, newRelease.version);
  assert.equal(newRelease.version, require('../package.json').version);
  const plan = summarizePlan(oldRelease.map, newRelease.map);
  assert.equal(plan.newInstallerBytes, newRelease.info.size);
  const root = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'local-release-update-'));
  const cacheDir = path.join(dir, 'cache'), pendingDir = path.join(dir, 'pending');
  fs.mkdirSync(cacheDir); fs.mkdirSync(pendingDir);
  fs.copyFileSync(oldRelease.installer, path.join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME));
  const route = release => `/v${release.version}/${release.name}`;
  const maps = new Map([oldRelease, newRelease].map(release => [route(release) + '.blockmap', release.blockmapBytes]));
  const measured = { rangeResponses: 0, rangeBodyBytes: 0, fullInstallerRequests: 0, blockmapRequests: 0 };
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const map = maps.get(req.url);
    if (map) {
      measured.blockmapRequests++;
      res.writeHead(200, { 'Content-Length': map.length }); res.end(map); return;
    }
    if (req.url !== route(newRelease)) { res.writeHead(404); res.end(); return; }
    if (!req.headers.range) {
      measured.fullInstallerRequests++;
      res.writeHead(409); res.end('Full-download fallback prohibited by this test'); return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    const start = Number(match?.[1]), end = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || end >= newRelease.info.size) {
      res.writeHead(416); res.end(); return;
    }
    measured.rangeResponses++;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${newRelease.info.size}`,
      'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    const stream = fs.createReadStream(newRelease.installer, { start, end });
    stream.on('data', bytes => { measured.rangeBodyBytes += bytes.length; });
    stream.on('error', error => res.destroy(error));
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let timeout;
  try {
    const url = new URL(`http://127.0.0.1:${server.address().port}${route(newRelease)}`);
    const verification = createVerification({ executor: new LoopbackExecutor(), cacheDir, pendingDir,
      oldVersion: oldRelease.version, newVersion: newRelease.version,
      fileInfo: { url, info: newRelease.info }, strict: true });
    timeout = setTimeout(() => verification.options.cancellationToken.cancel(), 120000);
    const destination = path.join(pendingDir, newRelease.name);
    assert.equal(await verification.differential(destination), false, 'Full fallback cannot pass');
    const reconstructed = fs.readFileSync(destination);
    assert.equal(reconstructed.length, newRelease.info.size);
    assert.equal(crypto.createHash('sha512').update(reconstructed).digest('base64'), newRelease.info.sha512);
    assert.equal(crypto.createHash('sha256').update(reconstructed).digest('hex'), newRelease.sha256);
    assert.equal(measured.fullInstallerRequests, 0);
    assert.equal(measured.blockmapRequests, 2);
    assert.equal(measured.rangeResponses, plan.rangeOperationCount);
    assert.equal(measured.rangeBodyBytes, plan.downloadBytes);
    const report = { status: 'passed', oldVersion: oldRelease.version, newVersion: newRelease.version,
      ...plan, transport: measured, sha512MatchesManifest: true, sha256MatchesNewInstaller: true,
      oldInstallerSha256: oldRelease.sha256, newInstallerSha256: newRelease.sha256,
      installerExecuted: false, productionCacheAccessed: false, externalNetworkRequests: 0 };
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, resultDirectory: dir }));
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
