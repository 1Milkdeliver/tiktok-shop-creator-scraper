'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createMessage, encodeMessage, validateMessage } = require('../lib/workers');

const projectRoot = path.join(__dirname, '..');
const workerRoot = path.join(projectRoot, 'runtime', 'python', 'workers');
const workerPath = path.join(workerRoot, 'youtube_worker.py');
const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

function invokeFixture(scenario) {
  const commands = [
    createMessage('hello', { seq: 0, payload: {} }),
    createMessage('task.start', {
      seq: 1,
      taskId: `youtube-${scenario}`,
      platform: 'youtube',
      payload: { fixtureMode: true, fixtureScenario: scenario },
    }),
    createMessage('shutdown', { seq: 2, payload: {} }),
  ];
  const result = spawnSync(pythonCommand, [workerPath], {
    cwd: workerRoot,
    input: commands.map(command => encodeMessage(command, { direction: 'command' })).join(''),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => validateMessage(JSON.parse(line), { direction: 'event' }));
}

test('YouTube fixture worker emits paginated normalized creator events without account configuration', { skip: !pythonAvailable }, () => {
  const events = invokeFixture('pagination');
  const items = events.filter(event => event.type === 'item');
  assert.deepEqual(events.map(event => event.type), [
    'worker.ready', 'task.accepted', 'session.updated', 'item', 'item', 'checkpoint',
    'progress', 'item', 'checkpoint', 'progress', 'task.completed',
  ]);
  assert.deepEqual(items.map(event => event.payload.nativeId), ['101', 'UC-garden-202', 'UC-studio-303']);
  assert.ok(items.every(event => typeof event.payload.nativeId === 'string' && event.payload.nativeId.length > 0));
  assert.equal(events.at(-1).payload.items, 3);
  assert.equal(JSON.stringify(events).includes('apiKey'), false);
  assert.equal(JSON.stringify(events).includes('account'), false);
});

test('YouTube fixture worker supports empty and missing-field payloads deterministically', { skip: !pythonAvailable }, () => {
  const empty = invokeFixture('empty');
  assert.equal(empty.filter(event => event.type === 'item').length, 0);
  assert.equal(empty.at(-1).type, 'task.completed');
  assert.equal(empty.at(-1).payload.items, 0);

  const missing = invokeFixture('missing_fields');
  const items = missing.filter(event => event.type === 'item');
  assert.deepEqual(items.map(event => event.payload.nativeId), ['90210']);
  assert.equal(items[0].payload.displayName, '');
  assert.equal(missing.filter(event => event.type === 'warning').at(0).payload.code, 'YOUTUBE_MISSING_NATIVE_ID');
});

test('YouTube fixture worker accepts a changed payload shape and classifies throttling as transient', { skip: !pythonAvailable }, () => {
  const changed = invokeFixture('changed_payload_shape');
  assert.equal(changed.find(event => event.type === 'item').payload.nativeId, 'UC-shape-404');
  assert.equal(changed.at(-1).type, 'task.completed');

  const throttled = invokeFixture('throttled');
  const failure = throttled.at(-1);
  assert.equal(failure.type, 'task.failed');
  assert.equal(failure.payload.code, 'THROTTLED');
  assert.equal(failure.payload.classification, 'transient');
});
