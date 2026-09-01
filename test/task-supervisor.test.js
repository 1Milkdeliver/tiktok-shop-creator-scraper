'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskSupervisor, TASK_STATES, TASK_ERROR_CODES } = require('../lib/tasks/supervisor');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('supervisor delegates a task lifecycle to a fake platform adapter', async () => {
  const run = deferred();
  const calls = [];
  const adapter = {
    start(config) { calls.push(['start', config]); return run.promise; },
    pause() { calls.push(['pause']); },
    resume() { calls.push(['resume']); },
    stop() { calls.push(['stop']); },
  };
  const supervisor = new TaskSupervisor({ adapters: { fake: adapter } });
  const completion = supervisor.start('fake', { query: 'shoes' });
  assert.equal(supervisor.status().state, TASK_STATES.RUNNING);
  supervisor.pause();
  assert.equal(supervisor.status().state, TASK_STATES.PAUSED);
  supervisor.resume();
  supervisor.stop();
  assert.equal(supervisor.status().state, TASK_STATES.STOPPED);
  run.resolve({ ok: true });
  await completion;
  assert.equal(supervisor.status().state, TASK_STATES.DONE);
  assert.deepEqual(calls, [['start', { query: 'shoes' }], ['pause'], ['resume'], ['stop']]);
});

test('supervisor enforces one active task and stable lifecycle errors', async () => {
  const run = deferred();
  const supervisor = new TaskSupervisor({ adapters: { fake: { start: () => run.promise, pause() {}, resume() {}, stop() {} } } });
  assert.throws(() => supervisor.pause(), (error) => error.code === TASK_ERROR_CODES.NO_ACTIVE_TASK);
  const completion = supervisor.start('fake', {});
  assert.throws(() => supervisor.start('fake', {}), (error) => error.code === TASK_ERROR_CODES.TASK_ALREADY_ACTIVE);
  assert.throws(() => supervisor.start('missing', {}), (error) => error.code === TASK_ERROR_CODES.TASK_ALREADY_ACTIVE);
  run.resolve();
  await completion;
  assert.throws(() => supervisor.start('missing', {}), (error) => error.code === TASK_ERROR_CODES.INVALID_PLATFORM);
});

test('supervisor uses an adapter refresh-resume operation when available', async () => {
  const run = deferred();
  const calls = [];
  const supervisor = new TaskSupervisor({ adapters: { fake: {
    start: () => run.promise, pause() { calls.push('pause'); }, resume() { calls.push('resume'); },
    resumeWithRefresh: async () => { calls.push('refresh'); }, stop() {},
  } } });
  const completion = supervisor.start('fake', {});
  supervisor.pause();
  await supervisor.resumeWithRefresh();
  assert.deepEqual(calls, ['pause', 'refresh']);
  run.resolve();
  await completion;
});
