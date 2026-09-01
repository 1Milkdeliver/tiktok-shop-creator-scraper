'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CollectionRunMetrics } = require('../lib/tasks/collection-run-metrics');

test('collection metrics report deterministic stability, success, and speed measures', () => {
  let time = 0;
  const metrics = new CollectionRunMetrics({ now: () => time });
  metrics.recordSuccess({ saved: 10 });
  metrics.recordFailure({ retrying: true });
  metrics.recordSuccess({ saved: 5 });
  time = 30_000;
  assert.deepEqual(metrics.summary(), {
    attempted: 3, completed: 2, failed: 1, retries: 1, saved: 15,
    successRate: 2 / 3, elapsedMs: 30_000, recordsPerMinute: 30,
  });
});
