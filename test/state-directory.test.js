'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  STATE_DIRECTORY_ERROR_CODES, StateDirectoryError, resolvePlatformStateDirectory,
} = require('../lib/credentials');

const ROOT = path.resolve(process.cwd(), '.test-platform-state');
const FIRST_ACCOUNT = '2a94c282-b670-4f9d-8fda-37271955ddf4';
const SECOND_ACCOUNT = '841f65d2-3634-4136-9e72-5b6c6386c372';

test('platform state directories are isolated by platform and opaque account reference', () => {
  const tiktok = resolvePlatformStateDirectory({ stateRoot: ROOT, platform: 'tiktok', accountRef: FIRST_ACCOUNT });
  const shop = resolvePlatformStateDirectory({ stateRoot: ROOT, platform: 'tiktok_shop', accountRef: FIRST_ACCOUNT });
  const instagram = resolvePlatformStateDirectory({ stateRoot: ROOT, platform: 'instagram', accountRef: FIRST_ACCOUNT });
  const xSecondAccount = resolvePlatformStateDirectory({ stateRoot: ROOT, platform: 'x', accountRef: SECOND_ACCOUNT });

  assert.equal(tiktok.directory, path.join(ROOT, 'tiktok', FIRST_ACCOUNT));
  assert.equal(shop.directory, path.join(ROOT, 'tiktok-shop', FIRST_ACCOUNT));
  assert.equal(instagram.directory, path.join(ROOT, 'instagram', FIRST_ACCOUNT));
  assert.equal(xSecondAccount.directory, path.join(ROOT, 'x', SECOND_ACCOUNT));
  assert.equal(new Set([tiktok.directory, shop.directory, instagram.directory, xSecondAccount.directory]).size, 4);
  assert.equal(Object.isFrozen(tiktok), true);
});

test('TikTok Shop compatibility alias resolves to the canonical isolated directory', () => {
  const canonical = resolvePlatformStateDirectory({ stateRoot: ROOT, platform: 'tiktok_shop', accountRef: FIRST_ACCOUNT });
  const legacy = resolvePlatformStateDirectory({ stateRoot: ROOT, platform: 'tiktok-shop', accountRef: FIRST_ACCOUNT });
  assert.deepEqual(legacy, canonical);
});

test('state resolver rejects traversal, unsupported platforms, relative roots, and non-opaque account values', () => {
  const invalidCases = [
    { stateRoot: ROOT, platform: '../instagram', accountRef: FIRST_ACCOUNT, code: STATE_DIRECTORY_ERROR_CODES.INVALID_PLATFORM },
    { stateRoot: ROOT, platform: 'youtube', accountRef: FIRST_ACCOUNT, code: STATE_DIRECTORY_ERROR_CODES.INVALID_PLATFORM },
    { stateRoot: 'relative-state-root', platform: 'instagram', accountRef: FIRST_ACCOUNT, code: STATE_DIRECTORY_ERROR_CODES.INVALID_ROOT },
    { stateRoot: ROOT, platform: 'instagram', accountRef: '../escape', code: STATE_DIRECTORY_ERROR_CODES.INVALID_ACCOUNT_REFERENCE },
    { stateRoot: ROOT, platform: 'instagram', accountRef: 'email=creator@example.test', code: STATE_DIRECTORY_ERROR_CODES.INVALID_ACCOUNT_REFERENCE },
    { stateRoot: ROOT, platform: 'instagram', accountRef: 'token-secret-value', code: STATE_DIRECTORY_ERROR_CODES.INVALID_ACCOUNT_REFERENCE },
  ];

  for (const invalid of invalidCases) {
    assert.throws(
      () => resolvePlatformStateDirectory(invalid),
      (error) => error instanceof StateDirectoryError && error.code === invalid.code,
    );
  }
});
