'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { WorkerProcessSupervisor } = require('../lib/workers');

const projectRoot = path.join(__dirname, '..');
const workerRoot = path.join(projectRoot, 'runtime', 'python', 'workers');
const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

function waitForEvent(supervisor, eventName) {
  return new Promise(resolve => supervisor.once(eventName, resolve));
}

function createSupervisor(platform) {
  return new WorkerProcessSupervisor({
    command: pythonCommand,
    args: [path.join(workerRoot, `${platform}_worker.py`)],
    cwd: workerRoot,
    startupTimeoutMs: 2_000,
    shutdownTimeoutMs: 1_000,
    killTimeoutMs: 250,
  });
}

for (const platform of ['instagram', 'youtube', 'x']) {
  test(`${platform} Python worker follows lifecycle without emitting credentials`, { skip: !pythonAvailable }, async () => {
    const supervisor = createSupervisor(platform);
    const events = [];
    const stderr = [];
    supervisor.on('event', event => events.push(event));
    supervisor.on('stderr', text => stderr.push(text));
    await supervisor.start();

    supervisor.startTask({ taskId: `${platform}-task`, platform });
    const auth = await waitForEvent(supervisor, 'auth.required');
    assert.equal(auth.payload.provider, platform);

    const terminal = waitForEvent(supervisor, 'task.completed');
    supervisor.provideAuth({
      taskId: `${platform}-task`,
      platform,
      payload: { accessToken: 'not-a-real-secret', password: 'not-a-real-secret' },
    });
    await terminal;

    const serializedEvents = JSON.stringify(events);
    assert.equal(serializedEvents.includes('not-a-real-secret'), false);
    assert.equal(stderr.join('\n').includes('not-a-real-secret'), false);
    assert.deepEqual(events.map(event => event.type), [
      'worker.ready', 'task.accepted', 'auth.required', 'session.updated', 'item',
      'checkpoint', 'progress', 'task.completed',
    ]);
    assert.equal(events.find(event => event.type === 'item').payload.isPlaceholder, true);
    await supervisor.shutdown();
  });
}

test('Python worker can cancel an authentication-pending task', { skip: !pythonAvailable }, async () => {
  const supervisor = createSupervisor('instagram');
  await supervisor.start();
  supervisor.startTask({ taskId: 'cancel-task', platform: 'instagram' });
  await waitForEvent(supervisor, 'auth.required');
  const failed = waitForEvent(supervisor, 'task.failed');
  supervisor.cancelTask({ taskId: 'cancel-task', platform: 'instagram' });
  const event = await failed;
  assert.equal(event.payload.code, 'cancelled');
  await supervisor.shutdown();
});
