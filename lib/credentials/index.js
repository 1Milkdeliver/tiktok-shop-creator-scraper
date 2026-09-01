'use strict';

const { CredentialBroker, redact, publicReference } = require('./broker');
const { SecretStore, MemoryStorage, CredentialStoreError, SECRET_ERROR_CODES, createAccountReference } = require('./secret-store');
const { EncryptedAppDataStorage } = require('./electron-storage');
const {
  PLATFORM_DIRECTORY_NAMES, STATE_DIRECTORY_ERROR_CODES, StateDirectoryError, resolvePlatformStateDirectory,
} = require('./state-directory');

module.exports = {
  CredentialBroker, SecretStore, MemoryStorage, CredentialStoreError, SECRET_ERROR_CODES, createAccountReference,
  redact, publicReference, EncryptedAppDataStorage,
  PLATFORM_DIRECTORY_NAMES, STATE_DIRECTORY_ERROR_CODES, StateDirectoryError, resolvePlatformStateDirectory,
};
