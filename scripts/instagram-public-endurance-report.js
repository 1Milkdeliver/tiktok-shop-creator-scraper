'use strict';

// Converts the durable no-Cookie endurance state into a safe final report.
// It never reads a database, Cookie, search-result page, account, or handle.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeState, summarizePublicEndurance } = require('../lib/tasks/instagram-public-endurance');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const stateFile = option('--state-file') || path.join('test-results', 'instagram-public-no-cookie-48h-state.json');
  const now = Date.now();
  const state = normalizeState(readJson(stateFile), { now, durationMs: 48 * 60 * 60 * 1000 });
  const summary = summarizePublicEndurance(state, now);
  const report = {
    ...summary,
    elapsedHours: Number((summary.elapsedMs / 3_600_000).toFixed(2)),
    targetHours: Number(((state.targetEndsAt - state.startedAt) / 3_600_000).toFixed(2)),
    remainingMinutes: Math.max(0, Math.ceil((state.targetEndsAt - now) / 60_000)),
    readyForFinalAssessment: now >= state.targetEndsAt,
    // These describe the deliberate operational boundary, not an estimate of
    // platform capacity.
    collectionBoundary: 'one public-search lane; no session and no profile-page traversal',
    dataSensitivity: 'aggregate counters only',
  };
  console.log(JSON.stringify(report));
}

try { main(); } catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PUBLIC_ENDURANCE_REPORT_FAILED' }));
  process.exitCode = 1;
}
