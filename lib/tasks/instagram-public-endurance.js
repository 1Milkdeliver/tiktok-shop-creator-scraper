'use strict';

// Durable scheduling policy for the no-Cookie public-discovery lane.  It is
// deliberately single-lane: parallel queries give little discovery benefit
// while making third-party search throttling substantially more likely.
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const THROTTLE_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_VERIFICATION_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const TRANSIENT_DELAYS_MS = [15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000];

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function createState({ now = Date.now(), durationMs, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const safeDuration = Math.max(finite(durationMs, 48 * 60 * 60 * 1000), 60 * 1000);
  return {
    version: 4,
    provider: 'public_no_cookie',
    startedAt: now,
    targetEndsAt: now + safeDuration,
    nextEligibleAt: now,
    intervalMs: Math.max(finite(intervalMs, DEFAULT_INTERVAL_MS), 60 * 1000),
    nextSeedIndex: 0,
    attempts: 0,
    completedSeeds: 0,
    successfulRequests: 0,
    zeroCandidateSeeds: 0,
    candidates: 0,
    throttles: 0,
    verificationPages: 0,
    consecutiveVerificationPages: 0,
    transientFailures: 0,
    consecutiveTransientFailures: 0,
    status: 'running',
    lastError: '',
    lastRunAt: 0,
    lastSearchDiagnostic: null,
  };
}

function normalizeState(value, options = {}) {
  const fresh = createState(options);
  const saved = value && typeof value === 'object' ? value : {};
  const normalized = {
    ...fresh,
    ...saved,
    version: 4,
    provider: 'public_no_cookie',
    intervalMs: Math.max(finite(saved.intervalMs, fresh.intervalMs), 60 * 1000),
    nextSeedIndex: Math.max(0, Math.floor(finite(saved.nextSeedIndex))),
    attempts: Math.max(0, Math.floor(finite(saved.attempts))),
    completedSeeds: Math.max(0, Math.floor(finite(saved.completedSeeds))),
    successfulRequests: Math.max(0, Math.floor(finite(saved.successfulRequests))),
    zeroCandidateSeeds: Math.max(0, Math.floor(finite(saved.zeroCandidateSeeds))),
    candidates: Math.max(0, Math.floor(finite(saved.candidates))),
    throttles: Math.max(0, Math.floor(finite(saved.throttles))),
    verificationPages: Math.max(0, Math.floor(finite(saved.verificationPages))),
    consecutiveVerificationPages: Math.max(0, Math.floor(finite(saved.consecutiveVerificationPages))),
    transientFailures: Math.max(0, Math.floor(finite(saved.transientFailures))),
    consecutiveTransientFailures: Math.max(0, Math.floor(finite(saved.consecutiveTransientFailures))),
    lastError: typeof saved.lastError === 'string' ? saved.lastError : '',
    lastSearchDiagnostic: saved.lastSearchDiagnostic && typeof saved.lastSearchDiagnostic === 'object' ? saved.lastSearchDiagnostic : null,
  };
  // v1 briefly counted an HTML verification page as a successful request.
  // Repair only that known, safely diagnosable historical case and cool down
  // before resuming. This keeps endurance metrics honest after an upgrade.
  if (finite(saved.version, 1) < 2 && normalized.lastSearchDiagnostic?.possibleVerificationPage) {
    normalized.successfulRequests = Math.max(0, normalized.successfulRequests - 1);
    normalized.verificationPages = Math.max(1, normalized.verificationPages);
    normalized.lastError = 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED';
    normalized.nextEligibleAt = Math.max(normalized.nextEligibleAt, finite(normalized.lastRunAt) + THROTTLE_COOLDOWN_MS);
  }
  // v2 preserved the corrected success counter, but its historic verification
  // event was still included in the zero-candidate counter. It was not an
  // empty search result, so remove that one misclassification on migration.
  if (finite(saved.version, 1) < 3 && normalized.lastSearchDiagnostic?.possibleVerificationPage) {
    normalized.zeroCandidateSeeds = Math.max(0, normalized.zeroCandidateSeeds - 1);
  }
  if (finite(saved.version, 1) < 4 && normalized.lastError === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED') {
    normalized.consecutiveVerificationPages = Math.max(1, normalized.consecutiveVerificationPages);
  }
  return normalized;
}

function publicEnduranceDecision(state, { now = Date.now(), seeds = [] } = {}) {
  if (state.status === 'complete' || now >= state.targetEndsAt) {
    return { action: 'complete' };
  }
  if (!Array.isArray(seeds) || !seeds.length) return { action: 'invalid_catalog' };
  if (now < state.nextEligibleAt) return { action: 'wait', retryAt: state.nextEligibleAt };
  const index = state.nextSeedIndex % seeds.length;
  return { action: 'run', seed: seeds[index], seedIndex: index };
}

function applyPublicEnduranceResult(state, result, { now = Date.now(), seedCount = 1 } = {}) {
  const next = { ...state, attempts: state.attempts + 1, lastRunAt: now };
  const advance = () => { next.nextSeedIndex = (state.nextSeedIndex + 1) % Math.max(seedCount, 1); };
  if (result?.ok) {
    const candidates = Math.max(0, Math.floor(finite(result.creators)));
    next.completedSeeds += 1;
    next.successfulRequests += 1;
    next.candidates += candidates;
    if (candidates === 0) next.zeroCandidateSeeds += 1;
    next.consecutiveTransientFailures = 0;
    next.consecutiveVerificationPages = 0;
    next.lastError = '';
    next.lastSearchDiagnostic = result.searchDiagnostics?.[0] || null;
    next.nextEligibleAt = now + next.intervalMs;
    advance();
    return next;
  }
  const code = result?.error || result?.code || 'PUBLIC_DISCOVERY_FAILED';
  next.lastError = String(code);
  if (code === 'PUBLIC_DISCOVERY_THROTTLED' || code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED') {
    next.throttles += 1;
    if (code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED') {
      next.verificationPages += 1;
      next.consecutiveVerificationPages += 1;
    }
    next.consecutiveTransientFailures = 0;
    next.lastSearchDiagnostic = result.searchDiagnostics?.[0] || null;
    const verificationCooldown = Math.min(THROTTLE_COOLDOWN_MS * (2 ** Math.max(next.consecutiveVerificationPages - 1, 0)), MAX_VERIFICATION_COOLDOWN_MS);
    next.nextEligibleAt = now + (code === 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED' ? verificationCooldown : THROTTLE_COOLDOWN_MS);
    return next;
  }
  next.transientFailures += 1;
  next.consecutiveTransientFailures += 1;
  const delay = TRANSIENT_DELAYS_MS[Math.min(next.consecutiveTransientFailures - 1, TRANSIENT_DELAYS_MS.length - 1)];
  next.nextEligibleAt = now + delay;
  return next;
}

function summarizePublicEndurance(state, now = Date.now()) {
  const requests = Math.max(0, state.successfulRequests + state.throttles + state.verificationPages + state.transientFailures);
  return {
    provider: 'public_no_cookie',
    status: now >= state.targetEndsAt ? 'complete' : state.status,
    startedAt: state.startedAt,
    targetEndsAt: state.targetEndsAt,
    nextEligibleAt: state.nextEligibleAt,
    attempts: state.attempts,
    completedSeeds: state.completedSeeds,
    successfulRequests: state.successfulRequests,
    candidates: state.candidates,
    zeroCandidateSeeds: state.zeroCandidateSeeds,
    throttles: state.throttles,
    verificationPages: state.verificationPages,
    consecutiveVerificationPages: state.consecutiveVerificationPages,
    transientFailures: state.transientFailures,
    requestSuccessRate: requests ? state.successfulRequests / requests : 0,
    elapsedMs: Math.max(0, now - state.startedAt),
    // The test never loads Instagram accounts, sessions, or public profiles.
    sessionLoaded: false,
    profilePagesLoaded: false,
    parallelLanes: 1,
    lastSearchDiagnostic: state.lastSearchDiagnostic,
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  THROTTLE_COOLDOWN_MS,
  MAX_VERIFICATION_COOLDOWN_MS,
  TRANSIENT_DELAYS_MS,
  createState,
  normalizeState,
  publicEnduranceDecision,
  applyPublicEnduranceResult,
  summarizePublicEndurance,
};
