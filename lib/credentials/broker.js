'use strict';

const { SecretStore, createAccountReference } = require('./secret-store');

const SENSITIVE_KEY = /(?:credential|secret|token|cookie|password|authorization|session)/i;

function publicReference(platform, accountRef) {
  return Object.freeze({ platform, accountRef });
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(entry)]));
}

class CredentialBroker {
  constructor({ secretStore = new SecretStore(), createReference = createAccountReference } = {}) {
    if (!secretStore || typeof secretStore.write !== 'function' || typeof secretStore.read !== 'function' || typeof secretStore.delete !== 'function') {
      throw new TypeError('secretStore must provide write, read, and delete methods');
    }
    if (typeof createReference !== 'function') throw new TypeError('createReference must be a function');
    this.secretStore = secretStore;
    this.createReference = createReference;
  }

  write(platform, credentials, { accountRef = this.createReference() } = {}) {
    this.secretStore.write(platform, accountRef, credentials);
    return publicReference(platform, accountRef);
  }

  read(platform, accountRef) { return this.secretStore.read(platform, accountRef); }
  delete(platform, accountRef) { return this.secretStore.delete(platform, accountRef); }

  updateSession(platform, accountRef, session) {
    const credentials = this.read(platform, accountRef);
    credentials.session = session;
    this.secretStore.write(platform, accountRef, credentials);
    return publicReference(platform, accountRef);
  }

  // Only this compact reference may be copied into a task payload.
  taskReference(platform, accountRef) { return publicReference(platform, accountRef); }
  redact(value) { return redact(value); }
}

module.exports = { CredentialBroker, redact, publicReference };
