'use strict';

const { CredentialStoreError, SECRET_ERROR_CODES } = require('./secret-store');

class EncryptedAppDataStorage {
  constructor({ appData, save, safeStorage }) {
    if (!appData || typeof appData !== 'object' || typeof save !== 'function' || !safeStorage) throw new TypeError('appData, save, and safeStorage are required');
    if (typeof safeStorage.isEncryptionAvailable !== 'function' || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') throw new TypeError('safeStorage must provide Electron safeStorage methods');
    this.appData = appData;
    this.save = save;
    this.safeStorage = safeStorage;
    this.appData.encryptedCredentials = this.appData.encryptedCredentials || {};
  }

  ensureAvailable() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED, 'Secure credential storage is unavailable on this device');
  }

  get(key) {
    this.ensureAvailable();
    const encoded = this.appData.encryptedCredentials[key];
    if (encoded === undefined) return undefined;
    try { return this.safeStorage.decryptString(Buffer.from(encoded, 'base64')); }
    catch (_) { throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED); }
  }

  set(key, value) {
    this.ensureAvailable();
    try {
      this.appData.encryptedCredentials[key] = this.safeStorage.encryptString(value).toString('base64');
      this.save();
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED);
    }
  }

  delete(key) {
    this.ensureAvailable();
    const existed = Object.prototype.hasOwnProperty.call(this.appData.encryptedCredentials, key);
    delete this.appData.encryptedCredentials[key];
    if (existed) this.save();
    return existed;
  }
}

module.exports = { EncryptedAppDataStorage };
