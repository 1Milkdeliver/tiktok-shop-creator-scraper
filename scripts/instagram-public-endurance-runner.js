'use strict';

// Runs at most one no-Cookie public search per invocation.  State contains
// aggregate counters only, making it safe to resume after an app restart.
const fs = require('node:fs');
const path = require('node:path');
const { runInstagramPublicDiscovery } = require('../lib/tasks/instagram-public-discovery');
const {
  DEFAULT_INTERVAL_MS,
  createState,
  normalizeState,
  publicEnduranceDecision,
  applyPublicEnduranceResult,
  summarizePublicEndurance,
} = require('../lib/tasks/instagram-public-endurance');

const SEEDS = [
  ['beauty', 'Beauty & Personal Care'], ['fashion', 'Fashion & Accessories'],
  ['pet supplies', 'Pets'], ['home', 'Home & Living'], ['tech', 'Consumer Electronics'],
  ['baby', 'Baby & Maternity'], ['fitness', 'Sports & Fitness'], ['food', 'Food & Beverage'],
  ['auto', 'Automotive'], ['outdoor', 'Outdoor & Travel'], ['lifestyle', 'Lifestyle'], ['shopping', 'Shopping'],
].map(([keyword, category]) => ({ keyword, category }));
const LOCK_STALE_MS = 5 * 60 * 1000;

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function numberOption(name, fallback) {
  const parsed = Number(option(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload), 'utf8');
  fs.renameSync(temporary, file);
}

function acquireRunLock(file, now) {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(path.resolve(lockFile)), { recursive: true });
  try {
    const descriptor = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify({ startedAt: now }));
    return { lockFile, descriptor };
  } catch (error) {
    if (error?.code !== 'EEXIST') return null;
    const saved = readJson(lockFile);
    // A crashed process cannot hold a real lock forever. Preserve its tiny
    // aggregate lock record for diagnosis, then resume with a new lock.
    if (now - Number(saved?.startedAt || now) > LOCK_STALE_MS) {
      try {
        fs.renameSync(lockFile, `${lockFile}.stale-${now}`);
        return acquireRunLock(file, now);
      } catch (_) {}
    }
    return null;
  }
}

function releaseRunLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.descriptor); } catch (_) {}
  try { fs.unlinkSync(lock.lockFile); } catch (_) {}
}

async function main() {
  const stateFile = option('--state-file') || path.join('test-results', 'instagram-public-no-cookie-48h-state.json');
  const progressFile = option('--progress-file') || path.join('test-results', 'instagram-public-no-cookie-48h-progress.json');
  const now = Date.now();
  const durationMs = Math.max(numberOption('--duration-hours', 48) * 60 * 60 * 1000, 60 * 1000);
  const intervalMs = Math.max(numberOption('--interval-ms', DEFAULT_INTERVAL_MS), 60 * 1000);
  const lock = acquireRunLock(stateFile, now);
  if (!lock) {
    const state = normalizeState(readJson(stateFile), { now, durationMs, intervalMs });
    console.log(JSON.stringify({ ...summarizePublicEndurance(state, now), skipped: 'already_running' }));
    return;
  }
  try {
    let state = normalizeState(readJson(stateFile), { now, durationMs, intervalMs });
    const decision = publicEnduranceDecision(state, { now, seeds: SEEDS });
    if (decision.action === 'complete') {
      state.status = 'complete';
    } else if (decision.action === 'run') {
    const repository = {
      async createScrapeJob() { return 'public-no-cookie-endurance'; },
      async upsertCreators(rows) { return { inserted: rows.length, updated: 0 }; },
      async finishScrapeJob() {},
    };
      try {
        const result = await runInstagramPublicDiscovery({
        databaseManager: { async getRepository() { return repository; } },
        region: 'GLOBAL', seeds: [decision.seed], maxResultsPerSeed: 10, seedGapMs: 60 * 1000,
        });
        state = applyPublicEnduranceResult(state, result, { now: Date.now(), seedCount: SEEDS.length });
      } catch (error) {
        state = applyPublicEnduranceResult(state, {
          ok: false, code: error?.code || 'PUBLIC_DISCOVERY_FAILED',
          searchDiagnostics: error?.searchDiagnostic ? [error.searchDiagnostic] : [],
        }, { now: Date.now(), seedCount: SEEDS.length });
      }
    }
    if (Date.now() >= state.targetEndsAt) state.status = 'complete';
    writeJson(stateFile, state);
    const summary = summarizePublicEndurance(state, Date.now());
    writeJson(progressFile, summary);
    console.log(JSON.stringify(summary));
  } finally {
    releaseRunLock(lock);
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PUBLIC_ENDURANCE_RUNNER_FAILED' }));
  process.exitCode = 1;
});
