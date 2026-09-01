'use strict';

// Read-only acceptance check for the Instagram browser candidate path.  It
// loads an already-imported local session, performs category searches at the
// production interval, and stores nothing in a creator database.

const fs = require('node:fs');
const path = require('node:path');
const { runInstagramHeadlessDiscovery } = require('../lib/tasks/instagram-headless-discovery');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const userData = option('--user-data');
  if (!userData) throw new Error('Missing --user-data');
  const appData = JSON.parse(fs.readFileSync(path.join(userData, 'app-data.json'), 'utf8'));
  const account = (appData.socialAccounts || []).filter(entry => entry.platform === 'instagram').at(-1);
  if (!account?.accountRef) throw new Error('No imported Instagram account is available');
  const stateRoot = path.join(userData, 'collector-state');
  const seedCount = Math.min(12, Math.max(1, Number(option('--seed-count')) || 3));
  const cycleCount = Math.min(3, Math.max(1, Number(option('--cycle-count')) || 1));
  const progressFile = option('--progress-file');
  const sessionStatePath = path.join(stateRoot, 'instagram', account.accountRef, 'session.json');
  const repository = {
    async createScrapeJob() { return 'headless-stability-check'; },
    async upsertCreators(rows) { return { inserted: rows.length, updated: 0 }; },
    async finishScrapeJob() {},
  };
  const seedCatalog = [
    { keyword: 'beauty', category: 'Beauty & Personal Care' },
    { keyword: 'fashion', category: 'Fashion & Accessories' },
    { keyword: 'home', category: 'Home & Living' },
    { keyword: 'tech', category: 'Electronics & Technology' },
    { keyword: 'fitness', category: 'Fitness & Wellness' },
    { keyword: 'food', category: 'Food & Beverage' },
    { keyword: 'pet supplies', category: 'Pets' },
    { keyword: 'baby', category: 'Baby & Kids' },
    { keyword: 'auto', category: 'Automotive' },
    { keyword: 'outdoor', category: 'Outdoor' },
    { keyword: 'lifestyle', category: 'Lifestyle' },
    { keyword: 'shopping', category: 'Shopping' },
  ].slice(0, seedCount);
  const seeds = Array.from({ length: cycleCount }, () => seedCatalog.map(seed => ({ ...seed }))).flat();
  const writeProgress = progress => {
    if (!progressFile) return;
    // A long-run test needs observability, but never records a handle,
    // Cookie, URL, account reference, or any page-derived value.
    const safeProgress = {
      at: new Date().toISOString(),
      state: String(progress?.state || ''),
      phase: String(progress?.phase || ''),
      completedSeeds: Math.max(0, Number(progress?.completedSeeds) || 0),
      totalSeeds: Math.max(0, Number(progress?.totalSeeds) || seeds.length),
      saved: Math.max(0, Number(progress?.saved) || 0),
    };
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify(safeProgress), 'utf8');
  };
  const result = await runInstagramHeadlessDiscovery({
    databaseManager: { async getRepository() { return repository; } },
    stateRoot,
    sessionStatePath,
    seeds,
    maxResultsPerSeed: 10,
    seedGapMs: Math.max(5_000, Number(option('--seed-gap-ms')) || 90_000),
    pageSettleMs: 1_500,
    onProgress: writeProgress,
  });
  const metrics = result.metrics || {};
  const summary = {
    ok: result.ok,
    seedsCompleted: Number(metrics.completed || 0),
    candidates: Number(result.creators || 0),
    discovery: {
      candidateLinks: Number(result.discovery?.candidateLinks || 0),
      uniqueCandidates: Number(result.discovery?.uniqueCandidates || 0),
      duplicateCandidates: Number(result.discovery?.duplicateCandidates || 0),
      emptySeeds: Number(result.discovery?.emptySeeds || 0),
    },
    elapsedMs: Number(metrics.elapsedMs || 0),
    successRate: Number(metrics.successRate || 0),
    recordsPerMinute: Number(metrics.recordsPerMinute || 0),
    seedGapMs: Math.max(5_000, Number(option('--seed-gap-ms')) || 90_000),
    seedCount: seeds.length,
    cycleCount,
  };
  const resultFile = option('--result-file');
  if (resultFile) {
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, JSON.stringify(summary), 'utf8');
  }
  console.log(JSON.stringify(summary));
}

main().catch(error => {
  const summary = { ok: false, code: error?.code || 'STABILITY_CHECK_FAILED', stage: error?.stage || null };
  const resultFile = option('--result-file');
  if (resultFile) {
    try {
      fs.mkdirSync(path.dirname(resultFile), { recursive: true });
      fs.writeFileSync(resultFile, JSON.stringify(summary), 'utf8');
    } catch (_) { /* A result-file write must never expose the original error. */ }
  }
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
});
