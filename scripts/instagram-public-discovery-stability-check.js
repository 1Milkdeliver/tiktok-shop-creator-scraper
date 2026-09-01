'use strict';

// Read-only live check for the no-Cookie public-discovery route. It only
// queries the search engine, never opens Instagram profiles, never loads a
// local account/session, and never writes a creator database.
const fs = require('node:fs');
const path = require('node:path');
const { runInstagramPublicDiscovery } = require('../lib/tasks/instagram-public-discovery');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const seedCount = Math.min(3, Math.max(1, Number(option('--seed-count')) || 3));
  const seedGapMs = Math.max(5_000, Number(option('--seed-gap-ms')) || 15_000);
  const defaultCatalog = [
    { keyword: 'beauty', category: 'Beauty & Personal Care' },
    { keyword: 'fashion', category: 'Fashion & Accessories' },
    { keyword: 'home', category: 'Home & Living' },
  ];
  const requestedKeyword = option('--keyword').trim();
  const catalog = requestedKeyword
    ? [{ keyword: requestedKeyword, category: 'Manual public-discovery diagnostic' }]
    : defaultCatalog.slice(0, seedCount);
  const repository = {
    async createScrapeJob() { return 'public-discovery-stability-check'; },
    async upsertCreators(rows) { return { inserted: rows.length, updated: 0 }; },
    async finishScrapeJob() {},
  };
  const result = await runInstagramPublicDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    region: 'GLOBAL',
    seeds: catalog,
    maxResultsPerSeed: 10,
    seedGapMs,
  });
  const summary = {
    ok: result.ok,
    provider: 'public_no_cookie',
    seedsCompleted: result.ok ? seedCount : 0,
    candidates: Number(result.creators || 0),
    elapsedMs: Number(result.metrics?.elapsedMs || 0),
    successRate: Number(result.metrics?.successRate || 0),
    recordsPerMinute: Number(result.metrics?.recordsPerMinute || 0),
    seedCount,
    seedGapMs,
    searchDiagnostics: Array.isArray(result.searchDiagnostics) ? result.searchDiagnostics : [],
  };
  const resultFile = option('--result-file');
  if (resultFile) {
    fs.mkdirSync(path.dirname(path.resolve(resultFile)), { recursive: true });
    fs.writeFileSync(resultFile, JSON.stringify(summary), 'utf8');
  }
  console.log(JSON.stringify(summary));
}

main().catch(error => {
  const summary = {
    ok: false,
    provider: 'public_no_cookie',
    code: error?.code || 'PUBLIC_DISCOVERY_STABILITY_CHECK_FAILED',
    // Only aggregate document shape; never log candidate URLs, handles, or
    // raw result-page text.
    searchDiagnostics: error?.searchDiagnostic ? [error.searchDiagnostic] : [],
  };
  const resultFile = option('--result-file');
  if (resultFile) {
    try { fs.mkdirSync(path.dirname(path.resolve(resultFile)), { recursive: true }); fs.writeFileSync(resultFile, JSON.stringify(summary), 'utf8'); } catch (_) {}
  }
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
});
