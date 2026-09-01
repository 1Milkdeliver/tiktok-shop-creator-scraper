'use strict';

const { DEFAULT_DISCOVERY_SEEDS, discoveryMetadata } = require('../discovery/ecommerce-defaults');
const { runLocalPythonCollection } = require('./local-python-collector');

// Runs one bounded public search per broad e-commerce category. Every seed is
// an existing TikTok Shop keyword, so the initial multi-platform taxonomy is
// consistent while platform-specific classification grows over time.
async function runDefaultYouTubeDiscovery(options = {}) {
  const maxResultsPerSeed = Math.min(Math.max(Number(options.maxResultsPerSeed) || 50, 1), 500);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const results = [];
  for (const [index, seed] of DEFAULT_DISCOVERY_SEEDS.entries()) {
    onProgress({ state: 'running', completedSeeds: index, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length, keyword: seed.keyword, category: seed.category });
    const result = await runLocalPythonCollection({
      ...options,
      platformId: 'youtube',
      onProgress: progress => onProgress({
        state: 'running', completedSeeds: index, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length,
        keyword: seed.keyword, category: seed.category, worker: progress,
      }),
      payload: {
        query: seed.keyword,
        maxResults: maxResultsPerSeed,
        language: options.language || 'en',
        region: options.sourceRegion || 'US',
      },
      discoveryMetadata: discoveryMetadata({
        mode: 'default', keyword: seed.keyword, category: seed.category, source: 'tiktok_shop_default_keywords',
      }),
    });
    results.push({ keyword: seed.keyword, category: seed.category, result });
    onProgress({ state: 'running', completedSeeds: index + 1, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length, keyword: seed.keyword, category: seed.category, saved: result.database?.saved || 0 });
  }
  const database = results.reduce((total, entry) => ({
    saved: total.saved + Number(entry.result.database?.saved || 0),
    inserted: total.inserted + Number(entry.result.database?.inserted || 0),
    updated: total.updated + Number(entry.result.database?.updated || 0),
  }), { saved: 0, inserted: 0, updated: 0 });
  return { ok: true, mode: 'default_discovery', seeds: results.map(({ keyword, category }) => ({ keyword, category })), creators: database.saved, database, results };
}

module.exports = { runDefaultYouTubeDiscovery };
