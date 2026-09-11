(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CreatorContactFields = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const FIELDS = [
    { k: 'whatsapp', n: 'WhatsApp', e: 'WhatsApp' },
    { k: 'line', n: 'LINE', e: 'LINE' },
    { k: 'zalo', n: 'Zalo', e: 'Zalo' },
    { k: 'viber', n: 'Viber', e: 'Viber' },
    { k: 'facebook', n: 'Facebook', e: 'Facebook' },
    { k: 'other_contacts', n: '其他联系方式', e: 'Other Contacts' },
    { k: 'whatsapp_country_code', n: 'WhatsApp 国家码', e: 'WhatsApp Country Code' },
    { k: 'line_country_code', n: 'LINE 国家码', e: 'LINE Country Code' },
    { k: 'zalo_country_code', n: 'Zalo 国家码', e: 'Zalo Country Code' },
    { k: 'viber_country_code', n: 'Viber 国家码', e: 'Viber Country Code' },
    { k: 'contact_source', n: '联系方式来源', e: 'Contact Source' },
    { k: 'contact_checked_at', n: '联系方式检查时间', e: 'Contacts Checked At' },
    { k: 'contact_status', n: '联系方式状态', e: 'Contact Status' },
  ].map(f => Object.freeze({ ...f, contact: true }));
  const KEYS = Object.freeze(['合作邮箱', ...FIELDS.map(f => f.k)]);
  const LABELS = Object.freeze(Object.fromEntries(FIELDS.map(f => [f.k, { zh: f.n, en: f.e }])));
  const TYPES = { 1: 'whatsapp', 2: '合作邮箱', 9: 'whatsapp_country_code', 31: 'line', 32: 'zalo', 33: 'viber', 34: 'facebook', 61: 'line_country_code', 62: 'zalo_country_code', 63: 'viber_country_code' };
  const SELLER_TYPES = new Set([0, 3, 4, 5, 6, 7, 8, 10, 21, 22, 23, 24, 41, 42, 43, 44, 45, 46, 51, 52, 53, 71, 72, 73, 74, 75, 76]);
  function text(value) { return typeof value === 'string' ? value.trim().slice(0, 8192) : ''; }
  function parseContacts(rows, checkedAt = new Date().toISOString()) {
    if (!Array.isArray(rows)) throw new Error('联系方式返回格式不正确');
    const patch = {}, other = [];
    for (const item of rows.slice(0, 100)) {
      if (!item || typeof item !== 'object') continue;
      const field = Number(item.field), value = text(item.value);
      if (!Number.isInteger(field) || field < 0 || SELLER_TYPES.has(field) || !value) continue;
      const key = TYPES[field];
      if (!key) { other.push({ field, value }); continue; }
      const values = new Set(patch[key] ? patch[key].split(' | ') : []);
      values.add(value); patch[key] = [...values].join(' | ');
      if (['whatsapp', 'line', 'zalo', 'viber'].includes(key) && text(item.country_code)) patch[key + '_country_code'] = text(item.country_code);
    }
    if (other.length) patch.other_contacts = JSON.stringify(other);
    const found = ['合作邮箱', 'whatsapp', 'line', 'zalo', 'viber', 'facebook', 'other_contacts'].some(k => patch[k]);
    return { ...patch, contact_source: 'TikTok Shop Partner Center', contact_checked_at: checkedAt, contact_status: found ? '已获取' : '未提供' };
  }
  return { FIELDS: Object.freeze(FIELDS), KEYS, LABELS, parseContacts };
});
