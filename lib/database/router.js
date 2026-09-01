'use strict';

const path = require('path');
const { PLATFORM_IDS, isPlatformId } = require('../platforms/catalog');
const product = require('../../product.config');

// Keep TikTok Shop on its shipped filename so existing Creator Library data is
// opened in place. Every other platform is deliberately assigned a different
// SQLite file; do not replace this with a platform column in a shared table.
const PLATFORM_DATABASE_FILENAMES = Object.freeze({ [product.platformId]: product.databaseFile });

function assertPlatformId(platformId) {
  if (!isPlatformId(platformId)) {
    throw new TypeError(`Unsupported platform ID: ${String(platformId)}`);
  }
  return platformId;
}

function getPlatformDatabaseFilename(platformId) {
  assertPlatformId(platformId);
  return PLATFORM_DATABASE_FILENAMES[platformId];
}

function resolvePlatformDatabasePath(dataDirectory, platformId) {
  if (typeof dataDirectory !== 'string' || dataDirectory.trim() === '') {
    throw new TypeError('dataDirectory must be a non-empty string');
  }
  return path.join(dataDirectory, getPlatformDatabaseFilename(platformId));
}

// Fail fast if the platform catalog gains an ID without an explicit storage
// decision. This protects against accidentally routing a new platform to the
// legacy TikTok Shop file.
for (const platformId of PLATFORM_IDS) {
  if (!Object.prototype.hasOwnProperty.call(PLATFORM_DATABASE_FILENAMES, platformId)) {
    throw new Error(`Missing database filename for platform: ${platformId}`);
  }
}

module.exports = {
  PLATFORM_DATABASE_FILENAMES,
  assertPlatformId,
  getPlatformDatabaseFilename,
  resolvePlatformDatabasePath,
};
