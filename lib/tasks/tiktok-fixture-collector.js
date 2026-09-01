'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createAdapter } = require('../platforms');

const TIKTOK_PLATFORM = 'tiktok';
const DEFAULT_FIXTURE_PATH = path.join(__dirname, '..', '..', 'test', 'fixtures', 'tiktok', 'public-creators.json');

function readFixture(filePath = DEFAULT_FIXTURE_PATH) {
  const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(fixture.creators)) throw new Error('TikTok fixture must contain creators');
  return fixture.creators;
}

// Fixture-only vertical flow for the public TikTok adapter. The injected
// collector deliberately has no network/browser dependency; production browser
// discovery is plugged into the same adapter separately.
async function runTikTokFixtureCollection({ databaseManager, region = 'GLOBAL', fixturePath, query = 'fixture' } = {}) {
  if (!databaseManager || typeof databaseManager.getRepository !== 'function') throw new TypeError('databaseManager.getRepository is required');
  const repository = await databaseManager.getRepository(TIKTOK_PLATFORM);
  const creators = readFixture(fixturePath);
  const jobId = await repository.createScrapeJob({ platformId: TIKTOK_PLATFORM, fixtureMode: true, query, shopRegion: region });
  const adapter = createAdapter(TIKTOK_PLATFORM, {
    collector: async (_config, context) => {
      for (const creator of creators) await context.onCandidate(creator);
      return [];
    },
  });
  try {
    const result = await adapter.start({ query, limit: creators.length });
    const saved = await repository.upsertCreators(result.creators, { region, jobId });
    const output = { ok: true, creators: result.creators.length, database: saved };
    await repository.finishScrapeJob(jobId, output);
    return output;
  } catch (error) {
    await repository.finishScrapeJob(jobId, { ok: false, error: error.code || 'TIKTOK_FIXTURE_COLLECTION_FAILED' }).catch(() => {});
    throw error;
  }
}

module.exports = { TIKTOK_PLATFORM, DEFAULT_FIXTURE_PATH, readFixture, runTikTokFixtureCollection };
