'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  InstagramCookieImportError, convertInstagramCookieExport, normalizeInstagramCookies,
} = require('../lib/credentials/instagram-cookie-import');

const cookieExport = JSON.stringify([
  { domain: '.instagram.com', name: 'sessionid', value: 'session-value' },
  { domain: '.instagram.com', name: 'csrftoken', value: 'csrf-value' },
  { domain: '.instagram.com', name: 'ds_user_id', value: '12345' },
  { domain: '.example.com', name: 'unrelated', value: 'discard' },
]);

test('Instagram browser Cookie JSON converts to instagrapi settings without unrelated domains', () => {
  const settings = convertInstagramCookieExport(cookieExport);
  assert.deepEqual(settings.cookies, { sessionid: 'session-value', csrftoken: 'csrf-value', ds_user_id: '12345' });
  assert.match(settings.uuids.phone_id, /^[0-9a-f-]{36}$/i);
  assert.match(settings.uuids.device_id, /^android-[0-9a-f]{16}$/);
});

test('Instagram Cookie import rejects malformed files and incomplete sessions without exposing values', () => {
  assert.throws(() => normalizeInstagramCookies('{bad json'), error => error instanceof InstagramCookieImportError && error.code === 'INSTAGRAM_COOKIE_JSON_INVALID');
  assert.throws(() => normalizeInstagramCookies(JSON.stringify([{ domain: '.instagram.com', name: 'sessionid', value: 'secret' }])), error => error.code === 'INSTAGRAM_COOKIE_REQUIRED_VALUES_MISSING' && !error.message.includes('secret'));
});

test('converted Cookie settings are loadable by the bundled Instagram adapter without a network request', t => {
  const root = path.join(__dirname, '..');
  const python = path.join(root, 'runtime', 'python', 'python', 'python.exe');
  if (!fs.existsSync(python)) t.skip('bundled Python runtime is unavailable');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-cookie-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sessionPath = path.join(directory, 'session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(convertInstagramCookieExport(cookieExport)), { mode: 0o600 });
  const workerDirectory = path.join(root, 'runtime', 'python', 'workers');
  childProcess.execFileSync(python, ['-c', "import sys; from instagram_collector_adapter import create_client; create_client(sys.argv[1]); print('loaded')", sessionPath], {
    cwd: workerDirectory,
    env: { ...process.env, COLLECTOR_STATE_ROOT: directory },
    encoding: 'utf8',
  });
});
