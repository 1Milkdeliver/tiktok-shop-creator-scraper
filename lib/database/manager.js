'use strict';

const { CreatorDatabase } = require('./index');
const { assertPlatformId, resolvePlatformDatabasePath } = require('./router');

// A platform-scoped facade makes the routing boundary explicit to callers.
// It intentionally delegates to the established CreatorDatabase schema rather
// than introducing any cross-platform creator or identity table.
class CreatorRepository {
  constructor(platformId, database) {
    this.platformId = assertPlatformId(platformId);
    if (!database) throw new TypeError('database is required');
    this.database = database;
  }

  async createScrapeJob(config = {}) {
    return this.database.createScrapeJob({ ...config, platformId: this.platformId });
  }

  getCreatorIds(region) { return this.database.getCreatorIds(region); }
  finishScrapeJob(id, result) { return this.database.finishScrapeJob(id, result); }
  upsertCreators(rows, options) { return this.database.upsertCreators(rows, options); }
  listCreators(filters) { return this.database.listCreators(filters); }
  listCreatorIds(filters) { return this.database.listCreatorIds(filters); }
  listScrapeJobs(filters) { return this.database.listScrapeJobs(filters); }
  getFilterOptions(key) { return this.database.getFilterOptions(key); }
  getCategoryTree() { return this.database.getCategoryTree(); }
  getStats() { return this.database.getStats(); }
}

class PlatformDatabaseManager {
  constructor(dataDirectory, options = {}) {
    if (typeof dataDirectory !== 'string' || dataDirectory.trim() === '') {
      throw new TypeError('dataDirectory must be a non-empty string');
    }
    this.dataDirectory = dataDirectory;
    this.createDatabase = options.createDatabase || (filePath => new CreatorDatabase(filePath));
    if (typeof this.createDatabase !== 'function') throw new TypeError('createDatabase must be a function');
    this.databases = new Map();
    this.repositories = new Map();
    this.opening = new Map();
  }

  getPath(platformId) {
    return resolvePlatformDatabasePath(this.dataDirectory, platformId);
  }

  async getDatabase(platformId) {
    platformId = assertPlatformId(platformId);
    if (this.databases.has(platformId)) return this.databases.get(platformId);
    if (this.opening.has(platformId)) return this.opening.get(platformId);

    const opening = (async () => {
      const database = this.createDatabase(this.getPath(platformId), platformId);
      if (!database || typeof database.open !== 'function') {
        throw new TypeError('createDatabase must return a database with open()');
      }
      await database.open();
      this.databases.set(platformId, database);
      return database;
    })();
    this.opening.set(platformId, opening);
    try {
      return await opening;
    } finally {
      this.opening.delete(platformId);
    }
  }

  async getRepository(platformId) {
    platformId = assertPlatformId(platformId);
    if (this.repositories.has(platformId)) return this.repositories.get(platformId);
    const repository = new CreatorRepository(platformId, await this.getDatabase(platformId));
    this.repositories.set(platformId, repository);
    return repository;
  }

  async close(platformId) {
    if (platformId === undefined) return this.closeAll();
    platformId = assertPlatformId(platformId);
    const database = this.databases.get(platformId);
    this.databases.delete(platformId);
    this.repositories.delete(platformId);
    if (database && typeof database.close === 'function') await database.close();
  }

  async closeAll() {
    const databases = [...this.databases.values()];
    this.databases.clear();
    this.repositories.clear();
    await Promise.all(databases.map(database => database.close()));
  }
}

module.exports = { CreatorRepository, PlatformDatabaseManager };
