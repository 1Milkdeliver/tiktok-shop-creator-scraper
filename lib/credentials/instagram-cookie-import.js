'use strict';

const crypto = require('crypto');

const REQUIRED_COOKIE_NAMES = Object.freeze(['sessionid', 'csrftoken', 'ds_user_id']);
const MAX_COOKIE_FILE_BYTES = 2 * 1024 * 1024;

class InstagramCookieImportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function cookieArrayFromExport(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.cookies)) return value.cookies;
  throw new InstagramCookieImportError('INSTAGRAM_COOKIE_JSON_INVALID');
}

function normalizeInstagramCookies(sourceText) {
  if (typeof sourceText !== 'string' || Buffer.byteLength(sourceText, 'utf8') > MAX_COOKIE_FILE_BYTES) {
    throw new InstagramCookieImportError('INSTAGRAM_COOKIE_FILE_INVALID');
  }
  let parsed;
  try { parsed = JSON.parse(sourceText); } catch (_) { throw new InstagramCookieImportError('INSTAGRAM_COOKIE_JSON_INVALID'); }
  const cookies = {};
  for (const entry of cookieArrayFromExport(parsed)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const value = typeof entry.value === 'string' ? entry.value : '';
    const domain = typeof entry.domain === 'string' ? entry.domain.toLowerCase() : '';
    if (!name || !value || (domain && !/(^|\.)instagram\.com$/.test(domain.replace(/^\./, '')))) continue;
    // The local client does not need unrelated browser cookies.  Retain only
    // simple cookie names to avoid accepting malformed export structures.
    if (/^[a-zA-Z0-9_]+$/.test(name)) cookies[name] = value;
  }
  const missing = REQUIRED_COOKIE_NAMES.filter(name => !cookies[name]);
  if (missing.length) throw new InstagramCookieImportError('INSTAGRAM_COOKIE_REQUIRED_VALUES_MISSING');
  return cookies;
}

function createInstagrapiSettings(cookies) {
  if (!cookies || typeof cookies !== 'object') throw new InstagramCookieImportError('INSTAGRAM_COOKIE_JSON_INVALID');
  return {
    // instagrapi restores this standard settings shape with Client.load_settings.
    cookies,
    uuids: {
      phone_id: crypto.randomUUID(),
      uuid: crypto.randomUUID(),
      client_session_id: crypto.randomUUID(),
      advertising_id: crypto.randomUUID(),
      device_id: `android-${crypto.randomBytes(8).toString('hex')}`,
    },
    last_login: new Date().toISOString(),
  };
}

function convertInstagramCookieExport(sourceText) {
  return createInstagrapiSettings(normalizeInstagramCookies(sourceText));
}

module.exports = {
  InstagramCookieImportError,
  REQUIRED_COOKIE_NAMES,
  normalizeInstagramCookies,
  createInstagrapiSettings,
  convertInstagramCookieExport,
};
