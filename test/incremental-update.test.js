'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { HttpExecutor, configureRequestUrl, configureRequestOptions } = require('builder-util-runtime');
const { createVerification, summarizePlan, CURRENT_APP_INSTALLER_FILE_NAME } = require('../scripts/update-verification-core');

class LoopbackExecutor extends HttpExecutor {
  createRequest(options, callback) {
    assert.equal(options.hostname || options.host, '127.0.0.1', 'Offline test must stay on loopback');
    return http.request(options, callback);
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

async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-updater-fixture-'));
  const cacheDir = path.join(dir, 'cache');
  const pendingDir = path.join(dir, 'pending');
  fs.mkdirSync(cacheDir); fs.mkdirSync(pendingDir);
  const oldBytes = Buffer.from('AAAABBBBCCCC');
  const newBytes = Buffer.from('AAAADDDDCCCC');
  const oldMap = { version: '2', files: [{ name: 'file', offset: 0, sizes: [4, 4, 4], checksums: ['a', 'b', 'c'] }] };
  const newMap = { version: options.incompatibleMap ? '3' : '2',
    files: [{ name: 'file', offset: 0, sizes: [4, 4, 4], checksums: ['a', 'd', 'c'] }] };
  if (!options.missingBase) fs.writeFileSync(path.join(cacheDir, CURRENT_APP_INSTALLER_FILE_NAME), oldBytes);
  if (options.corruptCachedMap) fs.writeFileSync(path.join(cacheDir, 'current.blockmap'), 'invalid gzip');
  if (options.validCachedMap) fs.writeFileSync(path.join(cacheDir, 'current.blockmap'), zlib.gzipSync(JSON.stringify(oldMap)));
  const calls = { range: 0, full: 0, oldMap: 0, newMap: 0 };
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('.blockmap')) {
      const isOld = req.url.includes('1.0.0');
      calls[isOld ? 'oldMap' : 'newMap']++;
      if (options.missingMap) { res.writeHead(404); res.end(); return; }
      res.end(zlib.gzipSync(JSON.stringify(isOld ? oldMap : newMap)));
    } else if (req.headers.range) {
      calls.range++;
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
      const bytes = options.corruptRange ? Buffer.alloc(Number(end) - Number(start) + 1, 88)
        : newBytes.subarray(Number(start), Number(end) + 1);
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${newBytes.length}` });
      res.end(bytes);
    } else {
      calls.full++;
      if (options.fullFailure) { res.writeHead(503); res.end(); return; }
      res.end(options.corruptFull ? Buffer.alloc(newBytes.length, 88) : newBytes);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Only remove this test's generated, tiny synthetic fixture; never any user cache.
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert(path.basename(dir).startsWith('creator-updater-fixture-'));
    fs.rmSync(dir, { recursive: true });
  });
  const url = new URL(`http://127.0.0.1:${server.address().port}/v2.0.0/app-2.0.0.exe`);
  const verification = createVerification({ executor: new LoopbackExecutor(), cacheDir, pendingDir,
    oldVersion: '1.0.0', newVersion: '2.0.0', strict: options.strict ?? false,
    fileInfo: { url, info: { url: 'app-2.0.0.exe', size: newBytes.length,
      sha512: crypto.createHash('sha512').update(newBytes).digest('base64') } } });
  const destination = path.join(pendingDir, 'reconstructed.exe');
  return { verification, destination, calls, oldMap, newMap, newBytes };
}

test('real updater downloads only changed ranges and reconstructs the exact file without blockMapSize', async t => {
  const f = await fixture(t, { strict: true });
  assert.equal(await f.verification.differential(f.destination), false);
  assert.deepEqual(fs.readFileSync(f.destination), f.newBytes);
  assert.deepEqual(f.calls, { range: 1, full: 0, oldMap: 1, newMap: 1 });
  assert.deepEqual(summarizePlan(f.oldMap, f.newMap), { copyBytes: 8, downloadBytes: 4,
    newInstallerBytes: 12, reusePercent: 66.67, operationCount: 3, rangeOperationCount: 1 });
});

test('a corrupt cached blockmap is recovered from the old release', async t => {
  const f = await fixture(t, { strict: true, corruptCachedMap: true });
  assert.equal(await f.verification.differential(f.destination), false);
  assert.equal(f.calls.oldMap, 1);
  assert.equal(f.calls.full, 0);
  assert.deepEqual(fs.readFileSync(f.destination), f.newBytes);
});

test('a valid cached old blockmap is reused without downloading it again', async t => {
  const f = await fixture(t, { strict: true, validCachedMap: true });
  assert.equal(await f.verification.differential(f.destination), false);
  assert.equal(f.calls.oldMap, 0);
  assert.equal(f.calls.full, 0);
  assert.deepEqual(fs.readFileSync(f.destination), f.newBytes);
});

for (const [name, options] of [
  ['missing old installer cache', { missingBase: true }],
  ['missing blockmap', { missingMap: true }],
  ['incompatible blockmap version', { incompatibleMap: true }],
  ['differential SHA-512 mismatch', { corruptRange: true }],
]) {
  test(`NSIS download task falls back to a verified full download after ${name}`, async t => {
    const f = await fixture(t, options);
    await f.verification.downloadWithFallback(f.destination);
    assert.equal(f.calls.full, 1);
    assert.deepEqual(fs.readFileSync(f.destination), f.newBytes);
  });
}

test('strict differential verification rejects corruption instead of passing via fallback', async t => {
  const f = await fixture(t, { strict: true, corruptRange: true });
  await assert.rejects(f.verification.differential(f.destination), /checksum mismatch/i);
  assert.equal(f.calls.full, 0);
});

test('both differential and full-download failure are surfaced, not reported as success', async t => {
  const f = await fixture(t, { missingMap: true, fullFailure: true });
  await assert.rejects(f.verification.downloadWithFallback(f.destination), /503/);
  assert.equal(f.calls.full, 1);
});

test('a corrupted full fallback also fails checksum verification', async t => {
  const f = await fixture(t, { missingBase: true, corruptFull: true });
  await assert.rejects(f.verification.downloadWithFallback(f.destination), /checksum mismatch/i);
  assert.equal(f.calls.full, 1);
});

test('application retains consent, silent installation and busy-task protection', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.match(source, /autoUpdater\.autoDownload\s*=\s*false/);
  assert.match(source, /autoUpdater\.autoInstallOnAppQuit\s*=\s*true/);
  assert.match(source, /autoUpdater\.downloadUpdate\(\)/);
  assert.match(source, /response === 0 && !runner\.running && !contactsBusy\(\)/);
  assert.match(source, /quitAndInstall\(true, true\)/);
  assert.doesNotMatch(source, /disableDifferentialDownload\s*=\s*true/);
});
