'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  PROTOCOL_VERSION, ProtocolError, createMessage, encodeMessage, validateMessage,
  JsonLinesParser, WorkerEventOrder,
} = require('../lib/workers');

function message(type, fields = {}) {
  return createMessage(type, { seq: fields.seq ?? 0, timestamp: '2026-08-26T00:00:00.000Z', ...fields });
}

test('JSONL parser reconstructs split UTF-8 input and validates messages', () => {
  const parser = new JsonLinesParser({ direction: 'event' });
  const wire = encodeMessage(message('worker.ready', { payload: { label: '达人' } }));
  const bytes = Buffer.from(wire);
  const character = Buffer.from('达');
  const splitAt = bytes.indexOf(character) + 1;
  assert.deepEqual(parser.push(bytes.subarray(0, splitAt)), []);
  const output = parser.push(bytes.subarray(splitAt));
  assert.equal(output.length, 1);
  assert.equal(output[0].payload.label, '达人');
  assert.deepEqual(parser.end(), []);
});

test('protocol rejects malformed messages, task metadata gaps, and numeric native IDs', () => {
  assert.throws(() => validateMessage({}), ProtocolError);
  assert.throws(() => message('task.start', { payload: {}, taskId: 't1' }), /platform/);
  assert.throws(() => message('item', { taskId: 't1', platform: 'tiktok_shop', payload: { nativeId: 42 } }), /nativeId/);
  assert.throws(() => new JsonLinesParser().push('{bad}\n'), /invalid JSONL/);
  assert.throws(() => validateMessage({ protocolVersion: PROTOCOL_VERSION, type: 'ping', seq: -1, timestamp: 'bad', payload: {} }), /seq/);
});

test('event order requires ready, accepted task, monotonic seq, and one terminal state', () => {
  const order = new WorkerEventOrder();
  assert.throws(() => order.observe(message('warning', { taskId: 't1', platform: 'tiktok_shop' })), /worker.ready/);
  order.observe(message('worker.ready', { seq: 1 }));
  order.observe(message('task.accepted', { seq: 2, taskId: 't1', platform: 'tiktok_shop' }));
  order.observe(message('progress', { seq: 3, taskId: 't1', platform: 'tiktok_shop' }));
  order.observe(message('task.completed', { seq: 4, taskId: 't1', platform: 'tiktok_shop' }));
  assert.throws(() => order.observe(message('item', { seq: 5, taskId: 't1', platform: 'tiktok_shop' })), /terminal/);
  assert.throws(() => order.observe(message('task.accepted', { seq: 4, taskId: 't2', platform: 'tiktok_shop' })), /monotonically/);
});

test('mock worker emits JSONL only, supports authentication and cancellation', async () => {
  const worker = spawn(process.execPath, [path.join(__dirname, '..', 'test-support', 'mock-worker.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const parser = new JsonLinesParser({ direction: 'event' });
  const order = new WorkerEventOrder();
  const events = [];
  let stderr = '';
  worker.stdout.on('data', chunk => {
    for (const event of parser.push(chunk)) { order.observe(event); events.push(event); }
  });
  worker.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`mock exited ${code}: ${stderr}`)));
  });
  const send = msg => worker.stdin.write(encodeMessage(msg));
  send(message('hello', { seq: 0 }));
  send(message('task.start', { seq: 1, taskId: 'auth-task', platform: 'tiktok_shop', payload: { requiresAuth: true } }));
  send(message('task.cancel', { seq: 2, taskId: 'auth-task', platform: 'tiktok_shop' }));
  send(message('shutdown', { seq: 3 }));
  await exited;
  assert.deepEqual(parser.end(), []);
  assert.equal(stderr, '');
  assert.deepEqual(events.map(event => event.type), ['worker.ready', 'task.accepted', 'auth.required', 'task.failed']);
  assert.equal(events.at(-1).payload.code, 'cancelled');
});
