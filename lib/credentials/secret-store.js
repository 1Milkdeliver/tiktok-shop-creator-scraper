'use strict';

const { randomUUID } = require('node:crypto');

const SECRET_ERROR_CODES = Object.freeze({
  INVALID_SCOPE: 'INVALID_CREDENTIAL_SCOPE',
  INVALID_SECRET: 'INVALID_SECRET',
  STORE_FAILED: 'CREDENTIAL_STORE_FAILED',
  NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
});

class CredentialStoreError extends Error {
  constructor(code, message = 'Credential operation failed') {
    // Do not preserve a lower-level error as `cause`: encryption and storage
    // providers can include the plaintext in their diagnostic messages.
    super(message);
    this.name = 'CredentialStoreError';
    this.code = code;
  }
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get(key) { return this.values.get(key); }
  set(key, value) { this.values.set(key, value); }
  delete(key) { return this.values.delete(key); }
}

function assertScope(platform, accountRef) {
  if (typeof platform !== 'string' || platform.trim() === '' || typeof accountRef !== 'string' || accountRef.trim() === '') {
    throw new CredentialStoreError(SECRET_ERROR_CODES.INVALID_SCOPE, 'Credential platform and account reference are required');
  }
}

function cloneSecret(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialStoreError(SECRET_ERROR_CODES.INVALID_SECRET, 'Credential value must be an object');
  }
  return JSON.parse(JSON.stringify(value));
}

function encodeKey(platform, accountRef) {
  // Prefix each part with its length so ("a:b", "c") can never collide with
  // ("a", "b:c"), even when an external storage implementation uses strings.
  return `credential:${platform.length}:${platform}:${accountRef.length}:${accountRef}`;
}

class SecretStore {
  constructor({ storage = new MemoryStorage(), encrypt = (value) => value, decrypt = (value) => value } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function' || typeof storage.delete !== 'function') {
      throw new TypeError('storage must provide get, set, and delete methods');
    }
    if (typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('encrypt and decrypt must be functions');
    this.storage = storage;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
  }

  write(platform, accountRef, secret) {
    assertScope(platform, accountRef);
    const plaintext = JSON.stringify(cloneSecret(secret));
    try {
      this.storage.set(encodeKey(platform, accountRef), this.encrypt(plaintext));
    } catch (_) {
      throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED);
    }
  }

  read(platform, accountRef) {
    assertScope(platform, accountRef);
    let encrypted;
    try { encrypted = this.storage.get(encodeKey(platform, accountRef)); }
    catch (_) { throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED); }
    if (encrypted === undefined || encrypted === null) throw new CredentialStoreError(SECRET_ERROR_CODES.NOT_FOUND, 'Credential reference was not found');
    try {
      return cloneSecret(JSON.parse(this.decrypt(encrypted)));
    } catch (_) {
      throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED);
    }
  }

  delete(platform, accountRef) {
    assertScope(platform, accountRef);
    try { return this.storage.delete(encodeKey(platform, accountRef)); }
    catch (_) { throw new CredentialStoreError(SECRET_ERROR_CODES.STORE_FAILED); }
  }
}

function createAccountReference() { return randomUUID(); }

module.exports = { SecretStore, MemoryStorage, CredentialStoreError, SECRET_ERROR_CODES, createAccountReference };
