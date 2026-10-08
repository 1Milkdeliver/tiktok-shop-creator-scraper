'use strict';

module.exports = Object.freeze({
  platformId: 'tiktok_shop',
  productName: 'TikTok Shop 达人采集',
  appId: 'com.creator.scraper.tiktokshop',
  // Keep the production filename used by v1.3.x-v1.5.x so upgrades reopen the
  // existing local Creator Library instead of creating an apparently empty DB.
  databaseFile: 'creators.db',
  maturity: 'production',
});
