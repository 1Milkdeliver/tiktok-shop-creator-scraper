'use strict';

// A deterministic JSONL-only worker used by the supervisor integration tests.
const { JsonLinesParser, createMessage, encodeMessage } = require('../lib/workers');

let seq = 0;
const parser = new JsonLinesParser({ direction: 'command' });
const pendingAuth = new Map();

function emit(type, fields = {}) {
  process.stdout.write(encodeMessage(createMessage(type, { ...fields, seq: seq++ })));
}

function finish(taskId, platform) {
  emit('session.updated', { taskId, platform, payload: { state: 'running' } });
  emit('item', { taskId, platform, payload: { nativeId: 'creator-001', title: 'Mock creator' } });
  emit('checkpoint', { taskId, platform, payload: { cursor: 'next-page' } });
  emit('progress', { taskId, platform, payload: { completed: 1, total: 1 } });
  emit('task.completed', { taskId, platform, payload: { items: 1 } });
}

function handle(message) {
  const { taskId, platform } = message;
  switch (message.type) {
    case 'hello':
      if (process.argv.includes('--silent')) break;
      if (process.argv.includes('--invalid')) {
        process.stdout.write('{invalid-json}\n');
        break;
      }
      emit('worker.ready', { payload: { protocolVersion: 1, mock: true } });
      break;
    case 'task.start':
      emit('task.accepted', { taskId, platform, payload: {} });
      if (message.payload.requiresAuth) {
        pendingAuth.set(taskId, platform);
        emit('auth.required', { taskId, platform, payload: { provider: 'mock' } });
      } else finish(taskId, platform);
      break;
    case 'auth.provide':
      if (pendingAuth.get(taskId) === platform) {
        pendingAuth.delete(taskId);
        finish(taskId, platform);
      }
      break;
    case 'task.cancel':
      pendingAuth.delete(taskId);
      emit('task.failed', { taskId, platform, payload: { code: 'cancelled', message: 'Mock task cancelled' } });
      break;
    case 'shutdown': process.exit(0); break;
    default: break;
  }
}

process.stdin.on('data', chunk => {
  for (const message of parser.push(chunk)) handle(message);
});
process.stdin.on('end', () => parser.end());
