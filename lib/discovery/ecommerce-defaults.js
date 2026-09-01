'use strict';

// These are deliberately drawn from the existing TikTok Shop keyword list.
// They are broad, high-signal entry points for a new library, not a claim that
// a single run can enumerate an entire platform.
const { DEFAULT_KEYWORDS } = require('../exporter');

const DEFAULT_DISCOVERY_SEEDS = Object.freeze([
  { keyword: 'beauty', category: 'Beauty & Personal Care' },
  { keyword: 'fashion', category: 'Fashion & Accessories' },
  { keyword: 'pet supplies', category: 'Pets' },
  { keyword: 'home', category: 'Home & Living' },
  { keyword: 'tech', category: 'Consumer Electronics' },
  { keyword: 'baby', category: 'Baby & Parenting' },
  { keyword: 'fitness', category: 'Fitness & Wellness' },
  { keyword: 'food', category: 'Food & Beverage' },
  { keyword: 'auto', category: 'Automotive' },
  { keyword: 'outdoor', category: 'Outdoor & Sports' },
  { keyword: 'lifestyle', category: 'Lifestyle' },
  { keyword: 'shopping', category: 'Deals & Shopping' },
].map(seed => {
  if (!DEFAULT_KEYWORDS.includes(seed.keyword)) throw new Error(`Default seed is not a TikTok Shop keyword: ${seed.keyword}`);
  return Object.freeze(seed);
}));

function discoveryMetadata({ mode = 'custom', keyword = '', category = '', source = 'user' } = {}) {
  return {
    collection_mode: mode === 'default' ? 'default_discovery'
      : mode === 'public_discovery' ? 'public_discovery'
        : mode === 'headless_candidate_discovery' || mode === 'automatic_candidate_discovery' ? 'candidate_discovery'
          : 'custom_target',
    discovery_source: source,
    source_keyword: String(keyword || '').trim(),
    keyword_category: String(category || '').trim(),
  };
}

module.exports = { DEFAULT_DISCOVERY_SEEDS, discoveryMetadata };
