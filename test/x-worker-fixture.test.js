'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createMessage, encodeMessage, validateMessage } = require('../lib/workers');

const projectRoot = path.join(__dirname, '..');
const workerRoot = path.join(projectRoot, 'runtime', 'python', 'workers');
const workerPath = path.join(workerRoot, 'x_worker.py');
const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

function invokeFixture(scenario, { cancel = false } = {}) {
  const taskId = `x-${scenario}`;
  const commands = [
    createMessage('hello', { seq: 0, payload: {} }),
    createMessage('task.start', { seq: 1, taskId, platform: 'x', payload: { fixtureMode: true, fixtureScenario: scenario } }),
  ];
  if (cancel) commands.push(createMessage('task.cancel', { seq: 2, taskId, platform: 'x', payload: {} }));
  commands.push(createMessage('shutdown', { seq: cancel ? 3 : 2, payload: {} }));
  const result = spawnSync(pythonCommand, [workerPath], {
    cwd: workerRoot,
    input: commands.map(command => encodeMessage(command, { direction: 'command' })).join(''),
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout.trim().split(/\r?\n/).filter(Boolean)
    .map(line => validateMessage(JSON.parse(line), { direction: 'event' }));
}

test('X fixture worker handles profile, search and content discovery without credentials', { skip: !pythonAvailable }, () => {
  for (const [scenario, expectedIds] of Object.entries({
    profile: ['10001'], search: ['search-200', 'search-201'], content: ['content-300'],
  })) {
    const events = invokeFixture(scenario);
    const items = events.filter(event => event.type === 'item');
    assert.deepEqual(items.map(event => event.payload.nativeId), expectedIds);
    assert.ok(items.every(event => event.payload.handle.startsWith('@')));
    assert.equal(events.at(-1).type, 'task.completed');
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes('accessToken'), false);
    assert.equal(serialized.includes('password'), false);
    assert.equal(serialized.includes('cookie'), false);
  }
});

test('X fixture worker classifies unavailable account and rate limit states without exposing pool internals', { skip: !pythonAvailable }, () => {
  const noAccount = invokeFixture('no_account');
  const noAccountFailure = noAccount.at(-1);
  assert.equal(noAccountFailure.type, 'task.failed');
  assert.equal(noAccountFailure.payload.code, 'NO_ACCOUNT_AVAILABLE');
  assert.equal(noAccountFailure.payload.classification, 'action_required');
  const state = noAccount.find(event => event.type === 'session.updated').payload;
  assert.deepEqual(state, { state: 'account_unavailable', mode: 'fixture', accountPoolRef: 'x-local-pool', accountState: 'unassigned' });

  const throttled = invokeFixture('rate_limit').at(-1);
  assert.equal(throttled.payload.code, 'THROTTLED');
  assert.equal(throttled.payload.classification, 'transient');
  assert.equal(JSON.stringify(noAccount).includes('accountId'), false);
});

test('X fixture cancellation is finite and emits exactly one terminal state', { skip: !pythonAvailable }, () => {
  const events = invokeFixture('cancel', { cancel: true });
  const finiteWait = events.find(event => event.type === 'warning');
  assert.equal(finiteWait.payload.code, 'X_FINITE_WAIT');
  assert.equal(finiteWait.payload.waitMs, 50);
  const terminalEvents = events.filter(event => ['task.completed', 'task.failed'].includes(event.type));
  assert.equal(terminalEvents.length, 1);
  assert.equal(terminalEvents[0].payload.code, 'cancelled');
  assert.equal(events.some(event => event.type === 'item'), false);
});
