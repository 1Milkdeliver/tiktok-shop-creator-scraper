'use strict';

// Offline release check: never loads the main process, user data or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');

const appDir = path.resolve(process.argv[2] || '');
const archive = path.join(appDir, 'resources', 'app.asar');
assert(fs.existsSync(archive), 'Pass a win-unpacked application directory');
const manifest = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(manifest.version, require('../package.json').version);
for (const name of ['puppeteer-core', 'sqlite3']) {
  const bundled = JSON.parse(asar.extractFile(archive, path.normalize('node_modules/' + name + '/package.json')));
  assert.equal(bundled.version, require('../package.json').dependencies[name]);
}
const entries = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'));
const required = [
  'main.js', 'preload.js', 'index.html', 'lib/multirunner.js', 'lib/browser.js', 'lib/cookies.js',
  'lib/session-startup.js', 'lib/account-cookies.js', 'lib/account-ui.js',
  'lib/partner-discovery.js', 'lib/partner-markets.js',
  'lib/database/index.js', 'lib/database/migrations.js',
  'lib/contact-fields.js', 'lib/contact-ui.js', 'lib/partner-contacts.js',
  'lib/collection-contacts.js', 'lib/scraper.js',
  'lib/partner-profile.js', 'lib/partner-profile-job.js',
  'lib/partner-profile-fields.js', 'lib/partner-page-observation.js',
];
for (const file of required) {
  assert(entries.includes('/' + file), 'Missing packaged module: ' + file);
  assert(asar.extractFile(archive, path.normalize(file)).equals(fs.readFileSync(path.join(__dirname, '..', file))),
    'Packaged source differs: ' + file);
}
for (const file of entries) {
  assert(!/^\/(?:dist|test-results|scripts|test|\.git)(?:\/|$)/.test(file), 'Unexpected packaged artifact');
  assert(!/\/(?:app-data\.json|json\.txt|cookies?[^/]*\.json|[^/]+\.(?:db|sqlite|sqlite3|har))$/i.test(file),
    'Unexpected private/runtime data');
}
assert(fs.existsSync(path.join(appDir, 'resources', 'app.asar.unpacked',
  'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node')), 'Missing native SQLite');

const runtimeCode = `
  const assert = require('node:assert/strict');
  const archive = process.argv[1];
  const { MultiRunner } = require(archive + '/lib/multirunner');
  const { CreatorDatabase } = require(archive + '/lib/database');
  const { PartnerContactClient, ContactJob } = require(archive + '/lib/partner-contacts');
  for (const ctor of [MultiRunner, CreatorDatabase, PartnerContactClient, ContactJob])
    assert.equal(typeof ctor, 'function');
  (async () => {
    const db = new CreatorDatabase(':memory:');
    try {
      await db.open();
      assert.equal((await db.get('SELECT COUNT(*) AS count FROM creators')).count, 0);
      console.log(JSON.stringify({ moduleExports: true, inMemoryMigrations: true,
        electron: process.versions.electron, userDataAccessed: false }));
    } finally { await db.close(); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
`;
const runtime = spawnSync(path.join(appDir, 'TikTokShop达人抓取.exe'), ['-e', runtimeCode, archive], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8', windowsHide: true, timeout: 30000,
});
assert.ifError(runtime.error);
assert.equal(runtime.status, 0, runtime.stderr || 'Packaged runtime check failed');
const runtimeResult = JSON.parse(runtime.stdout.trim());
assert.equal(runtimeResult.electron, require('../package.json').devDependencies.electron);
for (const [source, bundled] of [['README.md', 'README.md'], ['README.en.md', 'README-en.md']]) {
  assert(fs.readFileSync(path.join(__dirname, '..', source)).equals(fs.readFileSync(path.join(appDir, 'resources', bundled))),
    'Packaged documentation differs: ' + source);
}
console.log(JSON.stringify({
  version: manifest.version,
  requiredModules: required.length,
  asarSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  runtime: runtimeResult,
}));
