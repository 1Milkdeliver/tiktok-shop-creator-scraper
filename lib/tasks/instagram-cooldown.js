'use strict';

const DEFAULT_INSTAGRAM_COOLDOWN_MS = 30 * 60_000;

function normalizeCooldown(value, now = Date.now()) {
  const retryAt = Number(value?.retryAt);
  return Number.isFinite(retryAt) && retryAt > now ? { retryAt, code: 'THROTTLED' } : null;
}

function cooldownError(retryAt) {
  const error = new Error('Instagram collection is cooling down');
  error.code = 'INSTAGRAM_COOLDOWN';
  error.retryAt = retryAt;
  return error;
}

function assertInstagramAvailable(state, now = Date.now()) {
  const cooldown = normalizeCooldown(state, now);
  if (cooldown) throw cooldownError(cooldown.retryAt);
  return null;
}

function nextInstagramCooldown(error, now = Date.now(), cooldownMs = DEFAULT_INSTAGRAM_COOLDOWN_MS) {
  // A Hiker quota/rate event belongs to that paid provider only. It must not
  // lock the user's separate local Instagram session out of collection.
  if (error?.code !== 'THROTTLED') return null;
  return { retryAt: now + Math.max(60_000, Number(cooldownMs) || DEFAULT_INSTAGRAM_COOLDOWN_MS), code: 'THROTTLED' };
}

module.exports = { DEFAULT_INSTAGRAM_COOLDOWN_MS, normalizeCooldown, cooldownError, assertInstagramAvailable, nextInstagramCooldown };
