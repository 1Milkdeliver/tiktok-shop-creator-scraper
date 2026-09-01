'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTikTokAdapter, normalizeCreatorCandidate, TIKTOK_ADAPTER_ERROR_CODES,
} = require('../lib/platforms/adapters/tiktok');
const { assertAdapterContract, createAdapter } = require('../lib/platforms');

test('public TikTok adapter is registered and normalizes repository-shaped creator rows', () => {
  const adapter = createAdapter('tiktok');
  assert.equal(assertAdapterContract(adapter), adapter);
  assert.deepEqual(normalizeCreatorCandidate({
    uniqueId: '@creator.name', displayName: 'Creator Name', followers: 12500,
    categories: ['Beauty', 'Skin Care'], niche: 'Skincare', email: 'hello@example.com',
  }), {
    creator_oecuid: 'creator.name', handle: 'creator.name', nickname: 'Creator Name',
    category: 'Beauty | Skin Care', 垂直类目: 'Skincare', follower_cnt: 12500,
    简介: '', 合作邮箱: 'hello@example.com', profile_url: '', platform: 'tiktok', source: 'public_tiktok',
  });
});

test('public TikTok adapter validates discovery config and requires an injected collector', async () => {
  const adapter = createTikTokAdapter();
  await assert.rejects(adapter.start({}), error => error.code === TIKTOK_ADAPTER_ERROR_CODES.INVALID_TASK_CONFIG);
  await assert.rejects(adapter.start({ query: 'beauty' }), error => error.code === TIKTOK_ADAPTER_ERROR_CODES.COLLECTOR_UNAVAILABLE);
  await assert.rejects(adapter.start({ query: 'beauty', limit: 0 }), error => error.code === TIKTOK_ADAPTER_ERROR_CODES.INVALID_TASK_CONFIG);
});

test('public TikTok adapter emits lifecycle events and delegates browser/collector controls', async () => {
  const calls = [];
  const events = [];
  let context;
  const browser = { async close() { calls.push('browser.close'); } };
  const collector = {
    async collect(config, suppliedContext) {
      context = suppliedContext;
      calls.push(['collect', config.query, suppliedContext.browser]);
      await suppliedContext.onCandidate({ id: 'native-1', username: '@one', bio: 'about' });
      suppliedContext.onProgress({ scanned: 1 });
      return [{ id: 'native-2', handle: 'two' }];
    },
    pause() { calls.push('pause'); },
    resume() { calls.push('resume'); },
    stop() { calls.push('stop'); },
  };
  const adapter = createTikTokAdapter({ collector, browserFactory: async () => browser });
  adapter.on('event', event => events.push(event));
  const result = await adapter.start({ query: 'beauty', limit: 3 });
  assert.equal(context.signal.aborted, false);
  assert.deepEqual(result.creators.map(row => row.creator_oecuid), ['native-1', 'native-2']);
  assert.ok(events.some(event => event.type === 'status' && event.data.state === 'running'));
  assert.ok(events.some(event => event.type === 'progress' && event.nativeId === 'native-1'));
  assert.ok(events.some(event => event.type === 'result' && event.data.discovered === 2));
  assert.deepEqual(calls.at(-1), 'browser.close');
});

test('public TikTok adapter pause, resume, and stop are available during collection', async () => {
  let controls;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const collector = {
    async collect(_config, context) { controls = context; await waiting; },
    pause() {}, resume() {}, stop() { release(); },
  };
  const adapter = createTikTokAdapter({ collector });
  const completion = adapter.start({ handles: ['@one'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(adapter.pause(), true);
  assert.equal(adapter.resume(), true);
  assert.equal(adapter.stop(), true);
  const result = await completion;
  assert.equal(controls.signal.aborted, true);
  assert.equal(result.state, 'stopped');
  assert.equal(adapter.pause(), false);
});
