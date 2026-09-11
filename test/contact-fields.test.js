'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FIELDS, KEYS, LABELS, parseContacts } = require('../lib/contact-fields');
test('contact fields share unique UI/export keys and labels', () => {
  assert.equal(new Set(KEYS).size, KEYS.length);
  for (const f of FIELDS) assert.deepEqual(LABELS[f.k], { zh: f.n, en: f.e });
});
test('all creator contact types preserve leading zeroes and explicit country codes', () => {
  const p = parseContacts([{ field: 1, value: '00123456', country_code: '+60' }, { field: 2, value: 'test@example.com' }, { field: 31, value: 'line-id' }, { field: 61, value: '+66' }, { field: 32, value: '0012' }, { field: 33, value: '0098' }, { field: 34, value: 'example-page' }, { field: 99, value: 'future-type' }, { field: 3, value: 'not-a-creator-contact' }], '2026-09-08T00:00:00Z');
  assert.equal(p.whatsapp, '00123456'); assert.equal(p.whatsapp_country_code, '+60');
  assert.equal(p.line, 'line-id'); assert.equal(p.line_country_code, '+66');
  assert.equal(p.zalo, '0012'); assert.equal(p.viber, '0098'); assert.equal(p.facebook, 'example-page');
  assert.equal(p['合作邮箱'], 'test@example.com'); assert.equal(p.contact_status, '已获取');
  assert.deepEqual(JSON.parse(p.other_contacts), [{ field: 99, value: 'future-type' }]);
});
test('missing and invalid contacts stay empty, duplicate values are deduplicated', () => {
  assert.throws(() => parseContacts({}), /格式/);
  const p = parseContacts([{ field: 1, value: 123 }, { field: 31, value: null }, { field: 2, value: {} }]);
  assert.equal(p.whatsapp, undefined); assert.equal(p.contact_status, '未提供');
  assert.equal(parseContacts([{ field: 1, value: '001' }, { field: 1, value: '001' }, { field: 1, value: '002' }]).whatsapp, '001 | 002');
});
