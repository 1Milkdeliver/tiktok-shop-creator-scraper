'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EncryptedAppDataStorage, CredentialStoreError } = require('../lib/credentials');
const fs = require('node:fs');
const path = require('node:path');

function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => {
      const decoded = value.toString();
      if (!decoded.startsWith('encrypted:')) throw new Error('bad data');
      return decoded.slice('encrypted:'.length);
    },
  };
}

test('Electron credential storage persists only encrypted blobs', () => {
  const appData = {};
  let saves = 0;
  const storage = new EncryptedAppDataStorage({ appData, save: () => { saves += 1; }, safeStorage: fakeSafeStorage() });
  storage.set('credential:example', 'super-secret');
  assert.notEqual(appData.encryptedCredentials['credential:example'], 'super-secret');
  assert.equal(storage.get('credential:example'), 'super-secret');
  assert.equal(saves, 1);
  assert.equal(storage.delete('credential:example'), true);
  assert.equal(saves, 2);
});

test('Electron credential storage fails safely when OS encryption is unavailable', () => {
  const storage = new EncryptedAppDataStorage({ appData: {}, save: () => {}, safeStorage: fakeSafeStorage({ available: false }) });
  assert.throws(() => storage.set('credential:example', 'super-secret'), CredentialStoreError);
});

test('main process initializes the broker with Electron safeStorage and has no plaintext fallback', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /safeStorage/);
  assert.match(main, /new EncryptedAppDataStorage\(\{ appData, save: saveAppData, safeStorage \}\)/);
  assert.doesNotMatch(main, /new MemoryStorage/);
});
