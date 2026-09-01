'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createMessage, encodeMessage, validateMessage, WorkerEventOrder } = require('../lib/workers');

const projectRoot = path.join(__dirname, '..');
const workerRoot = path.join(projectRoot, 'runtime', 'python', 'workers');
const workerPath = path.join(workerRoot, 'instagram_worker.py');
const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

function invokeFixture(scenario) {
  const secret = 'do-not-echo-instagram-secret';
  const commands = [
    createMessage('hello', { seq: 0, payload: {} }),
    createMessage('task.start', {
      seq: 1,
      taskId: `instagram-${scenario}`,
      platform: 'instagram',
      payload: {
        fixtureMode: true,
        fixtureScenario: scenario,
        password: secret,
        session: secret,
        challengeCode: secret,
      },
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
  assert.equal(result.stdout.includes(secret), false);
  const order = new WorkerEventOrder();
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const event = validateMessage(JSON.parse(line), { direction: 'event' });
    return order.observe(event);
  });
}

test('Instagram profile fixture normalizes public profile data and public email only', { skip: !pythonAvailable }, () => {
  const events = invokeFixture('profile');
  const item = events.find(event => event.type === 'item');
  assert.deepEqual(events.map(event => event.type), [
    'worker.ready', 'task.accepted', 'session.updated', 'item', 'checkpoint', 'progress', 'task.completed',
  ]);
  assert.equal(item.payload.nativeId, '884422');
  assert.equal(item.payload.contact.email, 'hello@trailkitchen.example');
  assert.equal(events.at(-1).payload.items, 1);
});

test('Instagram no-email fixture represents absence without inventing a contact address', { skip: !pythonAvailable }, () => {
  const events = invokeFixture('no_email');
  const item = events.find(event => event.type === 'item');
  assert.equal(item.payload.nativeId, '993311');
  assert.deepEqual(item.payload.contact, {});
  assert.equal(Object.hasOwn(item.payload, 'password'), false);
  assert.equal(Object.hasOwn(item.payload, 'session'), false);
});

test('Instagram rate-limit, expired-session, and challenge states are explicit and safe', { skip: !pythonAvailable }, () => {
  const rateLimit = invokeFixture('rate_limit');
  assert.equal(rateLimit.at(-1).type, 'task.failed');
  assert.equal(rateLimit.at(-1).payload.code, 'THROTTLED');
  assert.equal(rateLimit.at(-1).payload.classification, 'transient');

  const expired = invokeFixture('session_expired');
  assert.equal(expired.find(event => event.type === 'session.updated').payload.state, 'expired');
  assert.equal(expired.find(event => event.type === 'auth.required').payload.reason, 'session_expired');
  assert.equal(expired.at(-1).payload.code, 'SESSION_EXPIRED');

  const challenge = invokeFixture('challenge');
  assert.deepEqual(challenge.map(event => event.type), [
    'worker.ready', 'task.accepted', 'session.updated', 'auth.required',
  ]);
  const auth = challenge.at(-1);
  assert.equal(auth.payload.reason, 'verification_challenge_required');
  assert.equal(JSON.stringify(challenge).includes('challengeCode'), false);
});

test('Instagram auth-required fixture reports a lifecycle event without secret echo', { skip: !pythonAvailable }, () => {
  const events = invokeFixture('auth_required');
  assert.deepEqual(events.map(event => event.type), [
    'worker.ready', 'task.accepted', 'session.updated', 'auth.required',
  ]);
  assert.equal(events.at(-1).payload.provider, 'instagram');
  assert.equal(events.at(-1).payload.reason, 'authentication_required');
});
