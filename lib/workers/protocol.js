'use strict';

const { StringDecoder } = require('node:string_decoder');

const PROTOCOL_VERSION = 1;

const COMMAND_TYPES = Object.freeze([
  'hello', 'task.start', 'task.cancel', 'auth.provide', 'ping', 'shutdown',
]);
const EVENT_TYPES = Object.freeze([
  'worker.ready', 'task.accepted', 'auth.required', 'session.updated', 'item',
  'checkpoint', 'progress', 'warning', 'task.completed', 'task.failed',
]);
const MESSAGE_TYPES = Object.freeze([...COMMAND_TYPES, ...EVENT_TYPES]);
const TASK_SCOPED_TYPES = new Set([
  'task.start', 'task.cancel', 'auth.provide', 'task.accepted', 'auth.required',
  'session.updated', 'item', 'checkpoint', 'progress', 'warning',
  'task.completed', 'task.failed',
]);
const TERMINAL_TYPES = new Set(['task.completed', 'task.failed']);

class ProtocolError extends Error {
  constructor(message, code = 'INVALID_MESSAGE') {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProtocolError(`${field} must be a non-empty string`);
  }
  return value;
}

function validateNativeId(value, field = 'nativeId') {
  return assertNonEmptyString(value, field);
}

function assertNativeIdsAreStrings(value, path = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNativeIdsAreStrings(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (/^(?:nativeId|nativeIds)$/i.test(key)) {
      if (Array.isArray(entry)) entry.forEach((id, index) => validateNativeId(id, `${entryPath}[${index}]`));
      else validateNativeId(entry, entryPath);
    } else {
      assertNativeIdsAreStrings(entry, entryPath);
    }
  }
}

function validateMessage(message, options = {}) {
  if (!isPlainObject(message)) throw new ProtocolError('message must be an object');
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError(`message.protocolVersion must be ${PROTOCOL_VERSION}`, 'UNSUPPORTED_VERSION');
  }
  if (!MESSAGE_TYPES.includes(message.type)) throw new ProtocolError(`unknown message type: ${String(message.type)}`);
  if (options.direction === 'command' && !COMMAND_TYPES.includes(message.type)) throw new ProtocolError('expected a command message');
  if (options.direction === 'event' && !EVENT_TYPES.includes(message.type)) throw new ProtocolError('expected a worker event');
  if (!Number.isSafeInteger(message.seq) || message.seq < 0) throw new ProtocolError('message.seq must be a non-negative safe integer');
  if (typeof message.timestamp !== 'string' || Number.isNaN(Date.parse(message.timestamp))) {
    throw new ProtocolError('message.timestamp must be an ISO-8601 timestamp string');
  }
  if (!isPlainObject(message.payload)) throw new ProtocolError('message.payload must be an object');

  const taskScoped = TASK_SCOPED_TYPES.has(message.type);
  if (taskScoped) {
    assertNonEmptyString(message.taskId, 'message.taskId');
    assertNonEmptyString(message.platform, 'message.platform');
  } else {
    if (message.taskId !== undefined) assertNonEmptyString(message.taskId, 'message.taskId');
    if (message.platform !== undefined) assertNonEmptyString(message.platform, 'message.platform');
  }
  assertNativeIdsAreStrings(message.payload);
  return message;
}

function createMessage(type, fields = {}) {
  return validateMessage({
    protocolVersion: PROTOCOL_VERSION,
    type,
    seq: fields.seq,
    timestamp: fields.timestamp || new Date().toISOString(),
    payload: fields.payload || {},
    ...(fields.taskId === undefined ? {} : { taskId: fields.taskId }),
    ...(fields.platform === undefined ? {} : { platform: fields.platform }),
  });
}

function encodeMessage(message, options) {
  return `${JSON.stringify(validateMessage(message, options))}\n`;
}

class JsonLinesParser {
  constructor(options = {}) {
    this.direction = options.direction;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    return this._drain(false);
  }

  end() {
    this.buffer += this.decoder.end();
    return this._drain(true);
  }

  _drain(final) {
    const messages = [];
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line === '') continue;
      messages.push(this._parse(line));
    }
    if (final && this.buffer !== '') {
      const line = this.buffer;
      this.buffer = '';
      messages.push(this._parse(line));
    }
    return messages;
  }

  _parse(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      throw new ProtocolError(`invalid JSONL message: ${error.message}`, 'INVALID_JSON');
    }
    return validateMessage(message, { direction: this.direction });
  }
}

class WorkerEventOrder {
  constructor() {
    this.ready = false;
    this.lastSeq = -1;
    this.tasks = new Map();
  }

  observe(message) {
    validateMessage(message, { direction: 'event' });
    if (message.seq <= this.lastSeq) throw new ProtocolError('worker event seq must increase monotonically', 'OUT_OF_ORDER');
    if (!this.ready && message.type !== 'worker.ready') throw new ProtocolError('worker.ready must be the first event', 'OUT_OF_ORDER');
    this.lastSeq = message.seq;
    if (message.type === 'worker.ready') {
      if (this.ready) throw new ProtocolError('worker.ready may only be emitted once', 'OUT_OF_ORDER');
      this.ready = true;
      return message;
    }
    const task = this.tasks.get(message.taskId);
    if (message.type === 'task.accepted') {
      if (task) throw new ProtocolError(`task ${message.taskId} was already accepted`, 'OUT_OF_ORDER');
      this.tasks.set(message.taskId, { platform: message.platform, terminal: false });
      return message;
    }
    if (!task) throw new ProtocolError(`task ${message.taskId} has not been accepted`, 'OUT_OF_ORDER');
    if (task.platform !== message.platform) throw new ProtocolError(`task ${message.taskId} platform changed`, 'OUT_OF_ORDER');
    if (task.terminal) throw new ProtocolError(`task ${message.taskId} is already terminal`, 'OUT_OF_ORDER');
    if (TERMINAL_TYPES.has(message.type)) task.terminal = true;
    return message;
  }
}

module.exports = {
  PROTOCOL_VERSION, COMMAND_TYPES, EVENT_TYPES, MESSAGE_TYPES, ProtocolError,
  validateNativeId, validateMessage, createMessage, encodeMessage, JsonLinesParser,
  WorkerEventOrder,
};
