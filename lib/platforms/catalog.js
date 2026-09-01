'use strict';

// Platform IDs are persistence-safe identifiers. Do not derive them from
// display names: saved jobs and future adapters must use these exact values.
const ALL_PLATFORM_IDS = Object.freeze([
  'tiktok_shop',
  'tiktok',
  'instagram',
  'youtube',
  'x',
]);

const product = require('../../product.config');
const singlePlatformId = String(product.platformId || '').trim();
const PLATFORM_IDS = Object.freeze(singlePlatformId && ALL_PLATFORM_IDS.includes(singlePlatformId)
  ? [singlePlatformId]
  : [...ALL_PLATFORM_IDS]);

const TASK_CAPABILITIES = Object.freeze([
  'creator_discovery',
  'creator_profile',
  'creator_export',
]);

const ALL_PLATFORM_CATALOG = Object.freeze([
  Object.freeze({
    id: 'tiktok_shop',
    name: Object.freeze({ zh: 'TikTok Shop', en: 'TikTok Shop' }),
    capabilities: Object.freeze(['creator_discovery', 'creator_profile', 'creator_export']),
  }),
  Object.freeze({
    id: 'tiktok',
    name: Object.freeze({ zh: 'TikTok', en: 'TikTok' }),
    capabilities: Object.freeze(['creator_discovery', 'creator_profile', 'creator_export']),
  }),
  Object.freeze({
    id: 'instagram',
    name: Object.freeze({ zh: 'Instagram', en: 'Instagram' }),
    capabilities: Object.freeze(['creator_discovery', 'creator_profile', 'creator_export']),
  }),
  Object.freeze({
    id: 'youtube',
    name: Object.freeze({ zh: 'YouTube', en: 'YouTube' }),
    capabilities: Object.freeze(['creator_discovery', 'creator_profile', 'creator_export']),
  }),
  Object.freeze({
    id: 'x',
    name: Object.freeze({ zh: 'X（原 Twitter）', en: 'X (formerly Twitter)' }),
    capabilities: Object.freeze(['creator_discovery', 'creator_profile', 'creator_export']),
  }),
]);

const PLATFORM_CATALOG = Object.freeze(ALL_PLATFORM_CATALOG.filter(platform => PLATFORM_IDS.includes(platform.id)));

function isPlatformId(value) {
  return typeof value === 'string' && PLATFORM_IDS.includes(value);
}

function getPlatform(platformId) {
  return PLATFORM_CATALOG.find(platform => platform.id === platformId) || null;
}

module.exports = { PLATFORM_IDS, TASK_CAPABILITIES, PLATFORM_CATALOG, isPlatformId, getPlatform };
