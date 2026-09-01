'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InstagramIdleCoverageScheduler } = require('../lib/tasks/instagram-idle-coverage-scheduler');

const seeds = [
  { keyword: 'beauty', category: 'Beauty' },
  { keyword: 'fashion', category: 'Fashion' },
];

function memoryStore(initial = null) {
  let value = initial;
  return { load: async () => value, save: async next => { value = next; }, value: () => value };
}

test('idle coverage runs one seed per eligible tick and restores the next seed safely', async () => {
  let clock = 1_000;
  const store = memoryStore({ nextSeedIndex: 1, completedSeeds: 4, lastStartedAt: 0 });
  const calls = [];
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, store, now: () => clock, intervalMs: 5_000, isIdle: () => true,
    isManualTaskRunning: () => false,
    runSeed: async entry => { calls.push(entry); return { database: { saved: 3 } }; },
  });
  const first = await scheduler.tick();
  assert.equal(first.ok, true);
  assert.deepEqual(calls.map(call => call.seed.keyword), ['fashion']);
  assert.equal(store.value().nextSeedIndex, 0);
  assert.equal(store.value().completedSeeds, 5);

  const tooSoon = await scheduler.tick();
  assert.equal(tooSoon.state, 'interval');
  assert.equal(calls.length, 1);

  clock += 5_000;
  await scheduler.tick();
  assert.deepEqual(calls.map(call => call.seed.keyword), ['fashion', 'beauty']);
});

test('idle coverage does not run while active or while a manual task is running', async () => {
  const events = [];
  let calls = 0;
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, isIdle: () => false, isManualTaskRunning: () => false,
    runSeed: async () => { calls += 1; }, onProgress: event => events.push(event),
  });
  assert.equal((await scheduler.tick()).state, 'system_active');
  scheduler.isIdle = () => true;
  scheduler.isManualTaskRunning = () => true;
  assert.equal((await scheduler.tick()).state, 'manual_task_running');
  assert.equal(calls, 0);
  assert.deepEqual(events.map(event => event.reason), ['system_active', 'manual_task_running']);
});

test('a throttled seed stays queued and resumes automatically after cooldown without persisting unsafe error text', async () => {
  const store = memoryStore();
  const events = [];
  let clock = 1_000;
  let calls = 0;
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, store, now: () => clock, intervalMs: 1_000, isIdle: () => true, isManualTaskRunning: () => false,
    runSeed: async () => {
      calls += 1;
      if (calls === 1) { const error = new Error('secret session=abc'); error.code = 'THROTTLED'; error.retryAt = 5_000; throw error; }
      return { database: { saved: 2 } };
    },
    onProgress: event => events.push(event),
  });
  const result = await scheduler.tick();
  assert.deepEqual({ ok: result.ok, state: result.state, errorCode: result.errorCode, retryAt: result.retryAt }, { ok: false, state: 'cooling_down', errorCode: 'THROTTLED', retryAt: 5_000 });
  assert.equal(store.value().nextSeedIndex, 0);
  assert.equal(store.value().lastErrorCode, 'THROTTLED');
  assert.equal((await scheduler.tick()).state, 'cooling_down');
  clock = 5_000;
  const resumed = await scheduler.tick();
  assert.equal(resumed.state, 'completed');
  assert.equal(store.value().nextSeedIndex, 1);
  assert.doesNotMatch(JSON.stringify({ events, state: store.value() }), /secret|session=abc/);
});

test('a transient browser failure keeps the same seed queued with a bounded automatic recovery delay', async () => {
  const store = memoryStore();
  const events = [];
  let clock = 1_000;
  let calls = 0;
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, store, now: () => clock, intervalMs: 1_000, isIdle: () => true, isManualTaskRunning: () => false,
    runSeed: async () => {
      calls += 1;
      if (calls === 1) { const error = new Error('temporary browser issue'); error.code = 'INSTAGRAM_TRANSIENT_FAILURE'; error.retryable = true; throw error; }
      return { database: { saved: 1 } };
    },
    onProgress: event => events.push(event),
  });
  const first = await scheduler.tick();
  assert.equal(first.state, 'recovering');
  assert.equal(store.value().nextSeedIndex, 0);
  assert.equal(store.value().transientRetryCount, 1);
  assert.equal(events.at(-1).state, 'recovering');
  clock = store.value().cooldownUntil;
  const resumed = await scheduler.tick();
  assert.equal(resumed.state, 'completed');
  assert.equal(store.value().nextSeedIndex, 1);
  assert.equal(store.value().transientRetryCount, 0);
});

test('after bounded transient recovery attempts a broken seed advances instead of blocking coverage forever', async () => {
  const store = memoryStore({ transientRetryCount: 3 });
  let clock = 1_000;
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, store, now: () => clock, intervalMs: 1_000, isIdle: () => true, isManualTaskRunning: () => false,
    runSeed: async () => { const error = new Error('temporary browser issue'); error.code = 'INSTAGRAM_TRANSIENT_FAILURE'; error.retryable = true; throw error; },
  });
  const result = await scheduler.tick();
  assert.equal(result.state, 'failed');
  assert.equal(store.value().nextSeedIndex, 1);
  assert.equal(store.value().failedSeeds, 1);
});

test('an app restart resumes the interrupted seed and records a safe recovery event', async () => {
  let clock = 10_000;
  const store = memoryStore({
    nextSeedIndex: 1,
    inFlightSeedIndex: 0,
    inFlightStartedAt: 1_000,
    lastStartedAt: 1_000,
    completedSeeds: 7,
  });
  const events = [];
  const calls = [];
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, store, now: () => clock, intervalMs: 5_000, isIdle: () => true, isManualTaskRunning: () => false,
    runSeed: async entry => { calls.push(entry); return { database: { saved: 2 } }; },
    onProgress: event => events.push(event),
  });
  const result = await scheduler.tick();
  assert.equal(result.state, 'completed');
  assert.deepEqual(calls.map(call => call.seed.keyword), ['beauty']);
  assert.equal(store.value().inFlightSeedIndex, null);
  assert.equal(store.value().nextSeedIndex, 1);
  assert.ok(events.some(event => event.state === 'recovering' && event.reason === 'interrupted_run'));
  assert.doesNotMatch(JSON.stringify({ events, state: store.value() }), /cookie|session|token/i);
});

test('start and stop use an injected timer without overlapping a running seed', async () => {
  let timer;
  let release;
  const completion = new Promise(resolve => { release = resolve; });
  const scheduler = new InstagramIdleCoverageScheduler({
    seeds, isIdle: () => true, isManualTaskRunning: () => false,
    runSeed: async () => completion,
    setInterval: callback => { timer = callback; return 42; }, clearInterval: id => { assert.equal(id, 42); },
  });
  scheduler.start();
  timer();
  timer();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.running, true);
  release();
  await new Promise(resolve => setImmediate(resolve));
  scheduler.stop();
});
