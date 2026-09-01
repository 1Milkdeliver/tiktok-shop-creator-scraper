'use strict';

const { TASK_CAPABILITIES, getPlatform, isPlatformId } = require('./catalog');

const EVENT_TYPES = Object.freeze(['status', 'progress', 'log', 'result', 'error']);
const STATUS_VALUES = Object.freeze(['idle', 'running', 'paused', 'stopped', 'done', 'error']);

function contractError(message) {
  return new TypeError(`Invalid platform adapter contract: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Native IDs are intentionally strings. Numeric IDs lose precision and handles
// may contain leading zeroes or platform-specific punctuation.
function validateNativeId(nativeId, fieldName = 'nativeId') {
  if (typeof nativeId !== 'string' || nativeId.trim() === '') {
    throw contractError(`${fieldName} must be a non-empty string`);
  }
  return nativeId;
}

function validateStructuredEvent(event, expectedPlatformId) {
  if (!isPlainObject(event)) throw contractError('event must be an object');
  if (!isPlatformId(event.platformId)) throw contractError('event.platformId must be a supported platform ID');
  if (expectedPlatformId && event.platformId !== expectedPlatformId) {
    throw contractError(`event.platformId must be ${expectedPlatformId}`);
  }
  if (!EVENT_TYPES.includes(event.type)) throw contractError('event.type must be a supported event type');
  if (event.taskCapability !== undefined && !TASK_CAPABILITIES.includes(event.taskCapability)) {
    throw contractError('event.taskCapability must be a supported task capability');
  }
  if (event.nativeId !== undefined) validateNativeId(event.nativeId, 'event.nativeId');
  if (event.data !== undefined && !isPlainObject(event.data)) throw contractError('event.data must be an object');
  if (event.at !== undefined && !(typeof event.at === 'string' || typeof event.at === 'number')) {
    throw contractError('event.at must be an ISO string or timestamp');
  }
  return event;
}

// An adapter is deliberately small: orchestration owns scheduling while each
// platform owns its native workflow. Methods may be async or synchronous.
function assertAdapterContract(adapter) {
  if (!isPlainObject(adapter)) throw contractError('adapter must be an object');
  if (!isPlatformId(adapter.platformId)) throw contractError('adapter.platformId must be a supported platform ID');
  if (!Array.isArray(adapter.taskCapabilities) || adapter.taskCapabilities.length === 0) {
    throw contractError('adapter.taskCapabilities must be a non-empty array');
  }
  const platform = getPlatform(adapter.platformId);
  for (const capability of adapter.taskCapabilities) {
    if (!TASK_CAPABILITIES.includes(capability)) throw contractError(`unknown task capability: ${capability}`);
    if (!platform.capabilities.includes(capability)) {
      throw contractError(`capability ${capability} is not catalogued for ${adapter.platformId}`);
    }
  }
  for (const method of ['start', 'pause', 'resume', 'stop', 'validateNativeId', 'validateEvent']) {
    if (typeof adapter[method] !== 'function') throw contractError(`adapter.${method} must be a function`);
  }
  return adapter;
}

module.exports = {
  EVENT_TYPES,
  STATUS_VALUES,
  validateNativeId,
  validateStructuredEvent,
  assertAdapterContract,
};
