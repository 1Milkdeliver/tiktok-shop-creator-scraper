'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  DEFAULT_INTERVAL_MS, THROTTLE_COOLDOWN_MS, createState, normalizeState, publicEnduranceDecision,
  applyPublicEnduranceResult, summarizePublicEndurance,
} = require('../lib/tasks/instagram-public-endurance');

test('public endurance runs one seed then waits at a durable low-frequency interval', () => {
  const state = createState({ now: 1_000, durationMs: 48 * 60 * 60 * 1000 });
  const decision = publicEnduranceDecision(state, { now: 1_000, seeds: [{ keyword: 'beauty' }] });
  assert.equal(decision.action, 'run');
  const next = applyPublicEnduranceResult(state, { ok: true, creators: 0 }, { now: 2_000, seedCount: 12 });
  assert.equal(next.successfulRequests, 1);
  assert.equal(next.zeroCandidateSeeds, 1);
  assert.equal(next.nextEligibleAt, 2_000 + DEFAULT_INTERVAL_MS);
  assert.equal(publicEnduranceDecision(next, { now: 2_001, seeds: [{ keyword: 'beauty' }] }).action, 'wait');
});

test('public endurance cools down rather than retrying a public-search throttle', () => {
  const state = createState({ now: 1_000, durationMs: 48 * 60 * 60 * 1000 });
  const next = applyPublicEnduranceResult(state, { ok: false, code: 'PUBLIC_DISCOVERY_THROTTLED' }, { now: 2_000, seedCount: 12 });
  assert.equal(next.throttles, 1);
  assert.equal(next.nextSeedIndex, 0);
  assert.equal(next.nextEligibleAt, 2_000 + THROTTLE_COOLDOWN_MS);
});

test('a verification page is a cooldown event, not a successful discovery request', () => {
  const state = createState({ now: 1_000, durationMs: 48 * 60 * 60 * 1000 });
  const next = applyPublicEnduranceResult(state, {
    ok: false, code: 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED',
    searchDiagnostics: [{ possibleVerificationPage: true, candidateCount: 0 }],
  }, { now: 2_000, seedCount: 12 });
  assert.equal(next.successfulRequests, 0);
  assert.equal(next.verificationPages, 1);
  assert.equal(next.consecutiveVerificationPages, 1);
  assert.equal(next.nextEligibleAt, 2_000 + THROTTLE_COOLDOWN_MS);
});

test('repeated verification pages increase cooldown and a healthy request resets that streak', () => {
  const state = createState({ now: 1_000, durationMs: 48 * 60 * 60 * 1000 });
  const first = applyPublicEnduranceResult(state, { ok: false, code: 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED' }, { now: 2_000, seedCount: 12 });
  const second = applyPublicEnduranceResult(first, { ok: false, code: 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED' }, { now: 3_000, seedCount: 12 });
  assert.equal(second.consecutiveVerificationPages, 2);
  assert.equal(second.nextEligibleAt, 3_000 + THROTTLE_COOLDOWN_MS * 2);
  const recovered = applyPublicEnduranceResult(second, { ok: true, creators: 0 }, { now: 4_000, seedCount: 12 });
  assert.equal(recovered.consecutiveVerificationPages, 0);
});

test('v1 endurance state repairs a historically misclassified verification page', () => {
  const migrated = normalizeState({
    version: 1, startedAt: 1_000, targetEndsAt: 9_000_000, lastRunAt: 2_000,
    successfulRequests: 2, lastSearchDiagnostic: { possibleVerificationPage: true },
  }, { now: 3_000, durationMs: 48 * 60 * 60 * 1000 });
  assert.equal(migrated.successfulRequests, 1);
  assert.equal(migrated.verificationPages, 1);
  assert.equal(migrated.nextEligibleAt, 2_000 + THROTTLE_COOLDOWN_MS);
});

test('endurance summary counts verification pages in the request success denominator', () => {
  const state = { ...createState({ now: 1_000, durationMs: 48 * 60 * 60 * 1000 }), successfulRequests: 1, verificationPages: 1 };
  assert.equal(summarizePublicEndurance(state, 2_000).requestSuccessRate, 0.5);
});

test('v2 endurance state removes a verification page from historical empty-result counts', () => {
  const migrated = normalizeState({
    version: 2, startedAt: 1_000, targetEndsAt: 9_000_000, zeroCandidateSeeds: 2,
    verificationPages: 1, lastSearchDiagnostic: { possibleVerificationPage: true },
  }, { now: 3_000, durationMs: 48 * 60 * 60 * 1000 });
  assert.equal(migrated.zeroCandidateSeeds, 1);
  assert.equal(migrated.verificationPages, 1);
});

test('public endurance summary discloses its no-session single-lane boundary', () => {
  const state = createState({ now: 1_000, durationMs: 48 * 60 * 60 * 1000 });
  const summary = summarizePublicEndurance(state, 2_000);
  assert.equal(summary.sessionLoaded, false);
  assert.equal(summary.profilePagesLoaded, false);
  assert.equal(summary.parallelLanes, 1);
});

test('endurance daemon exits cleanly when the persisted test is already complete', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instagram-endurance-daemon-'));
  const stateFile = path.join(directory, 'state.json');
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ status: 'complete', targetEndsAt: Date.now() - 1 }), 'utf8');
    const daemon = path.join(__dirname, '..', 'scripts', 'instagram-public-endurance-daemon.js');
    const result = spawnSync(process.execPath, [daemon, '--state-file', stateFile], { timeout: 5_000, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(`${stateFile}.daemon.lock`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
