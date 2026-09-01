'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CredentialBroker, SecretStore, MemoryStorage, CredentialStoreError, SECRET_ERROR_CODES,
} = require('../lib/credentials');

test('credentials are isolated by both platform and account reference', () => {
  const broker = new CredentialBroker();
  broker.write('tiktok-shop', { token: 'tiktok-token' }, { accountRef: 'shared-account' });
  broker.write('amazon', { token: 'amazon-token' }, { accountRef: 'shared-account' });
  assert.deepEqual(broker.read('tiktok-shop', 'shared-account'), { token: 'tiktok-token' });
  assert.deepEqual(broker.read('amazon', 'shared-account'), { token: 'amazon-token' });
  assert.throws(() => broker.read('etsy', 'shared-account'), (error) => error.code === SECRET_ERROR_CODES.NOT_FOUND);
});

test('generated account references are opaque and credentials do not serialize into task references', () => {
  const broker = new CredentialBroker();
  const reference = broker.write('tiktok-shop', { token: 'never-in-a-task' });
  assert.match(reference.accountRef, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(reference.accountRef, 'never-in-a-task');
  const serialized = JSON.stringify({ type: 'task.start', credentials: broker.taskReference(reference.platform, reference.accountRef) });
  assert.ok(!serialized.includes('never-in-a-task'));
  assert.equal(Object.isFrozen(reference), true);
});

test('storage encryption is injectable and session updates remain private', () => {
  const storage = new MemoryStorage();
  const broker = new CredentialBroker({ secretStore: new SecretStore({
    storage,
    encrypt: (text) => Buffer.from(text, 'utf8').toString('base64'),
    decrypt: (text) => Buffer.from(text, 'base64').toString('utf8'),
  }) });
  const ref = broker.write('tiktok-shop', { token: 'initial-token', profile: { id: '42' } });
  broker.updateSession(ref.platform, ref.accountRef, { cookie: 'fresh-session' });
  assert.deepEqual(broker.read(ref.platform, ref.accountRef), {
    token: 'initial-token', profile: { id: '42' }, session: { cookie: 'fresh-session' },
  });
  assert.ok(![...storage.values.values()].join('').includes('initial-token'));
});

test('redaction and provider failures never expose secret values in errors', () => {
  const secret = 'do-not-log-me';
  const broker = new CredentialBroker();
  assert.deepEqual(broker.redact({ token: secret, nested: { cookie: secret }, safe: 'shown' }), {
    token: '[REDACTED]', nested: { cookie: '[REDACTED]' }, safe: 'shown',
  });
  const store = new SecretStore({ encrypt: () => { throw new Error(`provider rejected ${secret}`); } });
  assert.throws(() => store.write('tiktok-shop', 'account', { token: secret }), (error) => {
    assert.ok(error instanceof CredentialStoreError);
    assert.equal(error.code, SECRET_ERROR_CODES.STORE_FAILED);
    assert.ok(!error.message.includes(secret));
    assert.ok(!error.stack.includes(secret));
    return true;
  });
});
