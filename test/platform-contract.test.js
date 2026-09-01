'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLATFORM_IDS, PLATFORM_CATALOG, createAdapter, getAdapterFactory,
  assertAdapterContract, validateNativeId, validateStructuredEvent,
} = require('../lib/platforms');

test('platform catalog has the fixed IDs and bilingual metadata', () => {
  assert.deepEqual(PLATFORM_IDS, ['tiktok_shop', 'tiktok', 'instagram', 'youtube', 'x']);
  assert.equal(PLATFORM_CATALOG.length, PLATFORM_IDS.length);
  for (const platform of PLATFORM_CATALOG) {
    assert.equal(typeof platform.name.zh, 'string');
    assert.equal(typeof platform.name.en, 'string');
    assert.ok(platform.capabilities.length > 0);
  }
});

test('TikTok Shop placeholder is registered and meets the adapter contract', async () => {
  assert.equal(typeof getAdapterFactory('tiktok_shop'), 'function');
  assert.equal(getAdapterFactory('instagram'), null);
  const adapter = createAdapter('tiktok_shop');
  assert.equal(assertAdapterContract(adapter), adapter);
  assert.equal(createAdapter('youtube'), null);
  assert.throws(() => adapter.validateNativeId(123), /non-empty string/);
  assert.equal(adapter.validateNativeId('00123'), '00123');
  await assert.rejects(adapter.start({}), /has not been wired/);
});

test('adapter contract checks native IDs, lifecycle methods, and structured events', () => {
  assert.throws(() => validateNativeId(''), /non-empty string/);
  const event = { platformId: 'tiktok_shop', type: 'progress', taskCapability: 'creator_discovery', nativeId: 'abc-01', data: { current: 1 }, at: Date.now() };
  assert.equal(validateStructuredEvent(event, 'tiktok_shop'), event);
  assert.throws(() => validateStructuredEvent({ ...event, platformId: 'youtube' }, 'tiktok_shop'), /must be tiktok_shop/);
  assert.throws(() => validateStructuredEvent({ ...event, nativeId: 1 }), /non-empty string/);
  assert.throws(() => assertAdapterContract({ platformId: 'tiktok_shop', taskCapabilities: ['creator_discovery'] }), /adapter.start/);
});

test('TikTok Shop adapter delegates lifecycle controls when a runner is supplied', async () => {
  const calls = [];
  const runner = {
    running: false,
    async start(config) { calls.push(['start', config]); },
    pause() { calls.push(['pause']); },
    resume() { calls.push(['resume']); },
    stop() { calls.push(['stop']); },
  };
  const adapter = createAdapter('tiktok_shop', { runnerFactory: () => runner });
  await adapter.start({ keyword: 'beauty' });
  assert.equal(adapter.pause(), true);
  assert.equal(adapter.resume(), true);
  assert.equal(adapter.stop(), true);
  assert.deepEqual(calls, [['start', { keyword: 'beauty' }], ['pause'], ['resume'], ['stop']]);
});
