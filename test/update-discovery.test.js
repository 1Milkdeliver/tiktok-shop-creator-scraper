'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const root = '/1Milkdeliver/tiktok-shop-creator-scraper';
const release = version => `<entry><title>${version}</title><link href="https://github.com${root}/releases/tag/v${version}"/><content>fixture</content></entry>`;

function makeFixture(version, fixed) {
  // The real constructor derives allowPrerelease from the application version.
  // No app/window/cache is loaded; only version discovery is exercised.
  const updater = new AppUpdater(null, { version, name: 'update-discovery-fixture' });
  updater.logger = { info() {}, warn() {}, error() {} };
  if (fixed) {
    const source = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
    const assignments = source.match(/^autoUpdater\.(?:allowPrerelease|allowDowngrade|autoDownload|autoInstallOnAppQuit) = (?:true|false);.*$/gm);
    assert(assignments?.length >= 4, 'Missing explicit updater policy');
    vm.runInNewContext(assignments.join('\n'), { autoUpdater: updater });
  }
  const requests = [];
  const executor = { request: async options => {
    const pathname = new URL(options.path, 'https://github.com').pathname;
    requests.push(pathname);
    if (pathname.endsWith('/releases.atom')) {
      // A newer beta appears before the published stable release.
      return `<?xml version="1.0"?><feed>${release('1.5.0-beta.1')}${release('1.4.0')}${release('1.3.1')}</feed>`;
    }
    if (pathname.endsWith('/releases/latest')) return JSON.stringify({ tag_name: 'v1.4.0' });
    if (pathname.endsWith('/v1.4.0/latest.yml')) {
      return 'version: 1.4.0\nfiles:\n  - url: app-1.4.0.exe\n    sha512: synthetic\n    size: 12\npath: app-1.4.0.exe\nsha512: synthetic\n';
    }
    throw new Error('Unexpected metadata request: ' + pathname);
  } };
  const provider = new GitHubProvider({ owner: '1Milkdeliver', repo: 'tiktok-shop-creator-scraper' },
    updater, { executor, platform: 'win32' });
  return { updater, provider, requests };
}

test('reproduces contacts preview being stranded on an unpublished custom channel', async () => {
  const { updater, provider } = makeFixture('1.3.2-contacts.2', false);
  assert.equal(updater.allowPrerelease, true);
  await assert.rejects(provider.getLatestVersion(), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' });
});

for (const version of ['1.3.2-contacts.2', '1.3.1', '1.4.0', '1.5.0']) {
  test(`production policy discovers stable metadata from ${version} without downloading or allowing downgrade`, async () => {
    const { updater, provider, requests } = makeFixture(version, true);
    const info = await provider.getLatestVersion();
    assert.equal(info.version, '1.4.0');
    assert.equal(info.tag, 'v1.4.0');
    assert.equal(updater.allowPrerelease, false);
    assert.equal(updater.allowDowngrade, false);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.deepEqual(requests, [root + '/releases.atom', root + '/releases/latest',
      root + '/releases/download/v1.4.0/latest.yml']);
    // Version discovery itself may return an older release; AppUpdater must not offer it.
    updater.isUpdateSupported = () => true;
    updater.isUserWithinRollout = () => true;
    assert.equal(await updater.isUpdateAvailable(info), ['1.3.2-contacts.2', '1.3.1'].includes(version));
  });
}
