'use strict';

const { DEFAULT_DISCOVERY_SEEDS, discoveryMetadata } = require('../discovery/ecommerce-defaults');
const { runLocalPythonCollection } = require('./local-python-collector');
const { CollectionRunMetrics } = require('./collection-run-metrics');

// Automatic discovery stops at a bounded account search.  It builds a
// candidate queue; directed refreshes are the separate, opt-in detail stage.
const DEFAULT_RESULTS_PER_SEED = 1;
const DEFAULT_SEED_GAP_MS = 5 * 60_000;
const DEFAULT_THROTTLE_COOLDOWN_MS = 30 * 60_000;
const DEFAULT_PROFILE_PAUSE_SECONDS = 20;
const MAX_THROTTLE_RETRIES = 0;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runDefaultInstagramDiscovery(options = {}) {
  // The seed run is intentionally a discovery-only candidate builder, rather
  // than an unattended profile-detail workload.
  const maxResultsPerSeed = Math.min(Math.max(Number(options.maxResultsPerSeed) || DEFAULT_RESULTS_PER_SEED, 1), 50);
  const seedGapMs = Math.max(Number(options.seedGapMs) || DEFAULT_SEED_GAP_MS, 1_000);
  const cooldownMs = Math.max(Number(options.throttleCooldownMs) || DEFAULT_THROTTLE_COOLDOWN_MS, 60_000);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const runCollection = typeof options.runCollection === 'function' ? options.runCollection : runLocalPythonCollection;
  const waitFor = typeof options.waitFor === 'function' ? options.waitFor : wait;
  const metrics = options.metrics || new CollectionRunMetrics({ now: options.now });
  const results = [];
  for (const [index, seed] of DEFAULT_DISCOVERY_SEEDS.entries()) {
    let attempt = 0;
    for (;;) {
      onProgress({ state: 'running', completedSeeds: index, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length, keyword: seed.keyword, category: seed.category, attempt });
      try {
        const result = await runCollection({
          ...options,
          platformId: 'instagram',
          onProgress: progress => onProgress({
            state: 'running', completedSeeds: index, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length,
            keyword: seed.keyword, category: seed.category, worker: progress,
          }),
          payload: {
            query: seed.keyword, maxResults: maxResultsPerSeed, sessionStatePath: options.sessionStatePath,
            discoveryOnly: true,
            requestDelaySeconds: 0,
            initialProfilePauseSeconds: 0,
          },
          discoveryMetadata: discoveryMetadata({
            mode: 'automatic_candidate_discovery', keyword: seed.keyword, category: seed.category, source: 'instagram_session_search',
          }),
        });
        results.push({ keyword: seed.keyword, category: seed.category, result });
        metrics.recordSuccess({ saved: result.database?.saved || 0 });
        onProgress({ state: 'running', completedSeeds: index + 1, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length, keyword: seed.keyword, category: seed.category, saved: result.database?.saved || 0 });
        break;
      } catch (error) {
        metrics.recordFailure({ retrying: error?.code === 'THROTTLED' && attempt < MAX_THROTTLE_RETRIES });
        if (error?.code !== 'THROTTLED' || attempt >= MAX_THROTTLE_RETRIES) throw error;
        attempt += 1;
        const resumeAt = new Date(Date.now() + cooldownMs).toISOString();
        onProgress({ state: 'cooling_down', completedSeeds: index, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length, keyword: seed.keyword, category: seed.category, attempt, resumeAt });
        await waitFor(cooldownMs);
      }
    }
    if (index < DEFAULT_DISCOVERY_SEEDS.length - 1) {
      onProgress({ state: 'waiting', completedSeeds: index + 1, totalSeeds: DEFAULT_DISCOVERY_SEEDS.length, keyword: seed.keyword, category: seed.category, nextDelayMs: seedGapMs });
      await waitFor(seedGapMs);
    }
  }
  const database = results.reduce((total, entry) => ({
    saved: total.saved + Number(entry.result.database?.saved || 0),
    inserted: total.inserted + Number(entry.result.database?.inserted || 0),
    updated: total.updated + Number(entry.result.database?.updated || 0),
  }), { saved: 0, inserted: 0, updated: 0 });
  return { ok: true, mode: 'default_discovery', seeds: results.map(({ keyword, category }) => ({ keyword, category })), creators: database.saved, database, metrics: metrics.summary(), results };
}

module.exports = {
  DEFAULT_RESULTS_PER_SEED, DEFAULT_SEED_GAP_MS, DEFAULT_THROTTLE_COOLDOWN_MS,
  DEFAULT_PROFILE_PAUSE_SECONDS, MAX_THROTTLE_RETRIES, runDefaultInstagramDiscovery,
};
