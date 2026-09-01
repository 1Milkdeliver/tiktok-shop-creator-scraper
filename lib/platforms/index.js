'use strict';

const catalog = require('./catalog');
const contract = require('./contract');
const { createTikTokShopAdapter } = require('./adapters/tiktok-shop');
const { createTikTokAdapter } = require('./adapters/tiktok');

// This registry is intentionally declarative for now. It does not alter the
// existing TikTok Shop startup path until an orchestrator opts into it.
const ADAPTER_FACTORIES = Object.freeze({
  tiktok_shop: createTikTokShopAdapter,
  tiktok: createTikTokAdapter,
});

function getAdapterFactory(platformId) {
  return ADAPTER_FACTORIES[platformId] || null;
}

function createAdapter(platformId, options) {
  const factory = getAdapterFactory(platformId);
  return factory ? factory(options) : null;
}

module.exports = {
  ...catalog, ...contract,
  createTikTokShopAdapter, createTikTokAdapter,
  ADAPTER_FACTORIES, getAdapterFactory, createAdapter,
};
