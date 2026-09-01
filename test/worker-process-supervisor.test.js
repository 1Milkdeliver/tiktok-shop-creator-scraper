'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  ERROR_CODES, WorkerSupervisorError, WorkerProcessSupervisor, redactText,
} = require('../lib/workers');

const mockWorker = path.join(__dirname, '..', 'test-support', 'mock-worker.js');

function createSupervisor(args = [], options = {}) {
  return new WorkerProcessSupervisor({
    command: process.execPath,
    args: [mockWorker, ...args],
    startupTimeoutMs: 500,
    shutdownTimeoutMs: 500,
    killTimeoutMs: 100,
    ...options,
  });
}

test('process supervisor starts a worker, relays validated events, and shuts it down', async () => {
  const supervisor = createSupervisor();
  const events = [];
  supervisor.on('event', event => events.push(event));
  const ready = await supervisor.start();
  assert.equal(ready.type, 'worker.ready');
  supervisor.startTask({ taskId: 'task-1', platform: 'instagram' });
  await new Promise(resolve => supervisor.once('task.completed', resolve));
  assert.deepEqual(events.map(event => event.type), [
    'worker.ready', 'task.accepted', 'session.updated', 'item', 'checkpoint', 'progress', 'task.completed',
  ]);
  await supervisor.shutdown();
  assert.equal(supervisor.running, false);
});

test('process supervisor supports authentication and task cancellation', async () => {
  const supervisor = createSupervisor();
  await supervisor.start();
  supervisor.startTask({ taskId: 'task-auth', platform: 'youtube', payload: { requiresAuth: true } });
  await new Promise(resolve => supervisor.once('auth.required', resolve));
  supervisor.cancelTask({ taskId: 'task-auth', platform: 'youtube' });
  const failed = await new Promise(resolve => supervisor.once('task.failed', resolve));
  assert.equal(failed.payload.code, 'cancelled');
  await supervisor.shutdown();
});

test('process supervisor rejects a non-ready worker after the startup timeout and terminates it', async () => {
  const supervisor = createSupervisor(['--silent'], { startupTimeoutMs: 50 });
  await assert.rejects(supervisor.start(), error => error instanceof WorkerSupervisorError && error.code === ERROR_CODES.STARTUP_TIMEOUT);
  await new Promise(resolve => supervisor.once('stopped', resolve));
  assert.equal(supervisor.running, false);
});

test('process supervisor rejects malformed stdout and redacts sensitive stderr text', async () => {
  const supervisor = createSupervisor(['--invalid']);
  const faults = [];
  supervisor.on('fault', error => faults.push(error));
  await assert.rejects(supervisor.start(), error => error.code === ERROR_CODES.PROTOCOL_ERROR);
  await new Promise(resolve => supervisor.once('stopped', resolve));
  assert.equal(faults.at(0).code, ERROR_CODES.PROTOCOL_ERROR);
  assert.equal(redactText('Authorization: Bearer abc123 token=def456'), 'Authorization: Bearer [REDACTED] token=[REDACTED]');
});
