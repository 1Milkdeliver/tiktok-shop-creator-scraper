'use strict';

// The scheduler deliberately owns scheduling state only.  Session files,
// account references and provider keys stay in the task runner that is
// injected through runSeed; nothing credential-like is accepted or saved here.
const { DEFAULT_DISCOVERY_SEEDS } = require('../discovery/ecommerce-defaults');

const STATE_VERSION = 2;
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_TRANSIENT_RETRY_MS = 10 * 60_000;
const MAX_TRANSIENT_RETRIES_PER_SEED = 3;

function asPromise(value) {
  return Promise.resolve(value);
}

function safeErrorCode(error) {
  const code = String(error?.code || 'COLLECTION_FAILED').toUpperCase();
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'COLLECTION_FAILED';
}

function normalizeState(value, seedCount) {
  const nextSeedIndex = Number(value?.nextSeedIndex);
  const inFlightSeedIndex = Number(value?.inFlightSeedIndex);
  const cooldownUntil = Number(value?.cooldownUntil);
  const normalizedInFlightSeedIndex = Number.isInteger(inFlightSeedIndex) && inFlightSeedIndex >= 0
    ? inFlightSeedIndex % seedCount : null;
  return {
    version: STATE_VERSION,
    // An interrupted run is intentionally retried before advancing coverage.
    // Each creator checkpoint is already durable, so this is safe and the
    // persistence layer turns any overlap into an update instead of a dup.
    nextSeedIndex: normalizedInFlightSeedIndex ?? (Number.isInteger(nextSeedIndex) && nextSeedIndex >= 0
      ? nextSeedIndex % seedCount : 0),
    inFlightSeedIndex: normalizedInFlightSeedIndex,
    inFlightStartedAt: normalizedInFlightSeedIndex === null ? 0
      : (Number.isFinite(Number(value?.inFlightStartedAt)) ? Number(value.inFlightStartedAt) : 0),
    lastStartedAt: Number.isFinite(Number(value?.lastStartedAt)) ? Number(value.lastStartedAt) : 0,
    lastCompletedAt: Number.isFinite(Number(value?.lastCompletedAt)) ? Number(value.lastCompletedAt) : 0,
    completedSeeds: Math.max(0, Number(value?.completedSeeds) || 0),
    failedSeeds: Math.max(0, Number(value?.failedSeeds) || 0),
    lastOutcome: value?.lastOutcome === 'failed' ? 'failed' : (value?.lastOutcome === 'completed' ? 'completed' : null),
    lastErrorCode: value?.lastOutcome === 'failed' ? safeErrorCode({ code: value?.lastErrorCode }) : null,
    // This is scheduling metadata only. It lets a rate-limited task wait and
    // resume from the same category instead of being presented as a failure.
    cooldownUntil: Number.isFinite(cooldownUntil) && cooldownUntil > 0 ? cooldownUntil : 0,
    transientRetryCount: Math.min(MAX_TRANSIENT_RETRIES_PER_SEED, Math.max(0, Number(value?.transientRetryCount) || 0)),
  };
}

/**
 * Bounded, single-seed idle scheduler for Instagram discovery.  A caller can
 * call tick from Electron's idle watcher, or use start() with an injected
 * timer.  The injected store only persists non-sensitive scheduling metadata.
 */
class InstagramIdleCoverageScheduler {
  constructor(options = {}) {
    if (typeof options.runSeed !== 'function') throw new TypeError('runSeed is required');
    this.seeds = Array.isArray(options.seeds) && options.seeds.length ? options.seeds : DEFAULT_DISCOVERY_SEEDS;
    this.runSeed = options.runSeed;
    this.isIdle = typeof options.isIdle === 'function' ? options.isIdle : () => false;
    this.isManualTaskRunning = typeof options.isManualTaskRunning === 'function' ? options.isManualTaskRunning : () => false;
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    this.store = options.store || {};
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.intervalMs = Math.max(1_000, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
    this.setInterval = options.setInterval || global.setInterval;
    this.clearInterval = options.clearInterval || global.clearInterval;
    this.timer = null;
    this.running = false;
    this.loaded = false;
    this.interruptedRun = false;
    this.state = normalizeState(null, this.seeds.length);
  }

  async _load() {
    if (this.loaded) return;
    const load = this.store.load || this.store.get;
    const stored = typeof load === 'function' ? await asPromise(load.call(this.store)) : null;
    this.state = normalizeState(stored, this.seeds.length);
    this.interruptedRun = this.state.inFlightSeedIndex !== null;
    this.loaded = true;
  }

  async _save() {
    const save = this.store.save || this.store.set;
    if (typeof save === 'function') await asPromise(save.call(this.store, { ...this.state }));
  }

  _event(state, extra = {}) {
    this.onProgress({ scheduler: 'instagram_idle_coverage', state, totalSeeds: this.seeds.length, ...extra });
  }

  getState() {
    return { ...this.state };
  }

  async tick() {
    await this._load();
    if (this.running) return { ok: false, state: 'busy' };
    if (!await asPromise(this.isIdle())) {
      this._event('skipped', { reason: 'system_active' });
      return { ok: false, state: 'system_active' };
    }
    if (await asPromise(this.isManualTaskRunning())) {
      this._event('skipped', { reason: 'manual_task_running' });
      return { ok: false, state: 'manual_task_running' };
    }
    const now = this.now();
    if (this.state.cooldownUntil > now) {
      this._event('cooling_down', { reason: 'rate_limited', retryAt: this.state.cooldownUntil });
      return { ok: false, state: 'cooling_down', retryAt: this.state.cooldownUntil };
    }
    const earliest = this.state.lastStartedAt + this.intervalMs;
    if (this.state.lastStartedAt && now < earliest) {
      this._event('waiting', { reason: 'interval', nextRunAt: earliest });
      return { ok: false, state: 'interval', nextRunAt: earliest };
    }

    const seedIndex = this.state.nextSeedIndex;
    const seed = this.seeds[seedIndex];
    this.running = true;
    if (this.interruptedRun) {
      this._event('recovering', {
        reason: 'interrupted_run',
        seed: { keyword: seed.keyword, category: seed.category },
        seedIndex,
        position: seedIndex + 1,
      });
      this.interruptedRun = false;
    }
    this.state.lastStartedAt = now;
    this.state.inFlightSeedIndex = seedIndex;
    this.state.inFlightStartedAt = now;
    await this._save();
    this._event('running', { seed: { keyword: seed.keyword, category: seed.category }, seedIndex, position: seedIndex + 1 });
    try {
      const result = await this.runSeed({ seed: { ...seed }, seedIndex, totalSeeds: this.seeds.length });
      const completedAt = this.now();
      this.state.nextSeedIndex = (seedIndex + 1) % this.seeds.length;
      this.state.completedSeeds += 1;
      this.state.lastCompletedAt = completedAt;
      this.state.lastOutcome = 'completed';
      this.state.lastErrorCode = null;
      this.state.cooldownUntil = 0;
      this.state.transientRetryCount = 0;
      this.state.inFlightSeedIndex = null;
      this.state.inFlightStartedAt = 0;
      await this._save();
      const saved = Math.max(0, Number(result?.database?.saved ?? result?.saved) || 0);
      this._event('completed', { seed: { keyword: seed.keyword, category: seed.category }, seedIndex, position: seedIndex + 1, saved });
      return { ok: true, state: 'completed', seed: { ...seed }, result };
    } catch (error) {
      const errorCode = safeErrorCode(error);
      if (errorCode === 'THROTTLED' || errorCode === 'INSTAGRAM_COOLDOWN') {
        const retryAt = Number(error?.retryAt);
        // Keep the same seed at the front of the queue.  The next eligible
        // idle tick resumes it automatically after a bounded cooldown.
        this.state.lastOutcome = 'failed';
        this.state.lastErrorCode = errorCode;
        this.state.inFlightSeedIndex = null;
        this.state.inFlightStartedAt = 0;
        this.state.cooldownUntil = Number.isFinite(retryAt) && retryAt > this.now()
          ? retryAt : this.now() + 30 * 60_000;
        await this._save();
        this._event('cooling_down', { seed: { keyword: seed.keyword, category: seed.category }, seedIndex, position: seedIndex + 1, errorCode, retryAt: this.state.cooldownUntil });
        return { ok: false, state: 'cooling_down', seed: { ...seed }, errorCode, retryAt: this.state.cooldownUntil };
      }
      if (error?.retryable === true && this.state.transientRetryCount < MAX_TRANSIENT_RETRIES_PER_SEED) {
        this.state.transientRetryCount += 1;
        this.state.lastOutcome = 'failed';
        this.state.lastErrorCode = errorCode;
        this.state.inFlightSeedIndex = null;
        this.state.inFlightStartedAt = 0;
        const retryDelayMs = Math.max(DEFAULT_TRANSIENT_RETRY_MS, Number(error?.retryDelayMs) || 0)
          * Math.pow(2, this.state.transientRetryCount - 1);
        this.state.cooldownUntil = this.now() + retryDelayMs;
        await this._save();
        this._event('recovering', { seed: { keyword: seed.keyword, category: seed.category }, seedIndex, position: seedIndex + 1, errorCode, retryAt: this.state.cooldownUntil, retryAttempt: this.state.transientRetryCount });
        return { ok: false, state: 'recovering', seed: { ...seed }, errorCode, retryAt: this.state.cooldownUntil };
      }
      // A failed seed still advances.  This prevents one blocked keyword from
      // consuming every idle window; the next coverage cycle tries it again.
      this.state.nextSeedIndex = (seedIndex + 1) % this.seeds.length;
      this.state.failedSeeds += 1;
      this.state.lastOutcome = 'failed';
      this.state.lastErrorCode = errorCode;
      this.state.inFlightSeedIndex = null;
      this.state.inFlightStartedAt = 0;
      await this._save();
      this._event('failed', { seed: { keyword: seed.keyword, category: seed.category }, seedIndex, position: seedIndex + 1, errorCode: this.state.lastErrorCode });
      return { ok: false, state: 'failed', seed: { ...seed }, errorCode: this.state.lastErrorCode };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = this.setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  stop() {
    if (!this.timer) return;
    this.clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { DEFAULT_INTERVAL_MS, DEFAULT_TRANSIENT_RETRY_MS, MAX_TRANSIENT_RETRIES_PER_SEED, STATE_VERSION, InstagramIdleCoverageScheduler, normalizeState };
