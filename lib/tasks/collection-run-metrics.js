'use strict';

// A small, deterministic metrics accumulator shared by local/offline tests and
// live task summaries. It records no credentials, URLs, or raw provider data.
class CollectionRunMetrics {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.startedAt = this.now();
    this.completed = 0;
    this.failed = 0;
    this.saved = 0;
    this.retries = 0;
  }

  recordSuccess({ saved = 0 } = {}) { this.completed += 1; this.saved += Math.max(0, Number(saved) || 0); }
  recordFailure({ retrying = false } = {}) { this.failed += 1; if (retrying) this.retries += 1; }

  summary() {
    const attempted = this.completed + this.failed;
    const elapsedMs = Math.max(0, this.now() - this.startedAt);
    return {
      attempted, completed: this.completed, failed: this.failed, retries: this.retries, saved: this.saved,
      successRate: attempted ? this.completed / attempted : 0,
      elapsedMs,
      recordsPerMinute: elapsedMs > 0 ? (this.saved * 60_000) / elapsedMs : 0,
    };
  }
}

module.exports = { CollectionRunMetrics };
