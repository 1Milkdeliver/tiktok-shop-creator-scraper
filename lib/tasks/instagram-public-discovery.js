'use strict';

const crypto = require('node:crypto');
const { DEFAULT_DISCOVERY_SEEDS, discoveryMetadata } = require('../discovery/ecommerce-defaults');
const { CreatorPersistence } = require('./creator-persistence');
const { CollectionRunMetrics } = require('./collection-run-metrics');

const DEFAULT_RESULTS_PER_SEED = 10;
const DEFAULT_SEED_GAP_MS = 2_000;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeHandle(value) {
  return text(value).replace(/^@/, '').toLowerCase();
}

function canonicalInstagramHandle(candidateUrl) {
  try {
    const url = new URL(candidateUrl);
    // Search engines also return business.instagram.com, help.instagram.com,
    // etc.  Those are not creator profiles and must never become candidates.
    if (!/^(?:www\.)?instagram\.com$/i.test(url.hostname)) return '';
    const handle = normalizeHandle(url.pathname.split('/').filter(Boolean)[0]);
    const excluded = new Set(['accounts', 'about', 'developer', 'directory', 'explore', 'legal', 'p', 'reel', 'reels', 'stories', 'tv']);
    return /^[a-z0-9._]{1,30}$/i.test(handle) && !excluded.has(handle) ? handle : '';
  } catch (_) {
    return '';
  }
}

function decodeHtml(value) {
  return text(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // Search result documents sometimes embed links inside JSON/script state
    // rather than literal markup. Decode only URL punctuation; this does not
    // execute or interpret any result content.
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/');
}

function unwrapBingUrl(candidateUrl) {
  try {
    const url = new URL(decodeHtml(candidateUrl));
    if (!/(^|\.)bing\.com$/i.test(url.hostname)) return url.toString();
    let encoded = url.searchParams.get('u') || '';
    if (encoded.startsWith('a1')) encoded = encoded.slice(2);
    if (!encoded) return url.toString();
    encoded += '='.repeat((4 - encoded.length % 4) % 4);
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    return decoded.startsWith('http') ? decoded : url.toString();
  } catch (_) {
    return decodeHtml(candidateUrl);
  }
}

function extractInstagramCandidates(html) {
  const decoded = decodeHtml(html);
  const urls = decoded.match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+\/?(?:[?#][^"'<>\s]*)?/gi) || [];
  // Bing changes both the position and quote style of the class attribute.
  // Keep extraction scoped to b_algo blocks, then accept their first anchor
  // URL rather than scanning arbitrary page links.
  const resultBlocks = decoded.match(/<li\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bb_algo\b)[^>]*>[\s\S]*?<\/li>/gi) || [];
  for (const block of resultBlocks) {
    const match = block.match(/<h2[^>]*>\s*<a[^>]+href\s*=\s*["']([^"']+)["']/i)
      || block.match(/<a[^>]+href\s*=\s*["']([^"']+)["']/i);
    if (match) urls.push(unwrapBingUrl(match[1]));
  }
  const seen = new Set();
  return urls.map(value => ({ handle: canonicalInstagramHandle(value), sourceUrl: value }))
    .filter(item => item.handle && !seen.has(item.handle) && seen.add(item.handle))
    .map(item => ({ ...item, profileUrl: `https://www.instagram.com/${item.handle}/` }));
}

function searchPageDiagnostics(html, candidates = []) {
  const decoded = decodeHtml(html);
  const directProfileLinks = (decoded.match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+\/?/gi) || []).length;
  const resultBlocks = (decoded.match(/<li\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bb_algo\b)[^>]*>/gi) || []).length;
  return {
    // Aggregate structure only: never retain result text, URLs, or handles.
    htmlBytes: Buffer.byteLength(decoded, 'utf8'),
    directProfileLinks,
    resultBlocks,
    candidateCount: Array.isArray(candidates) ? candidates.length : 0,
    possibleVerificationPage: /captcha|unusual traffic|verify (?:you are )?human|challenge/i.test(decoded),
  };
}

function bingSearchUrl(keyword) {
  const params = new URLSearchParams({
    // Excluding non-profile subdomains improves recall: otherwise their
    // documentation/business pages can occupy the small result window before
    // genuine public profile candidates are even considered.
    q: `site:instagram.com \"${text(keyword)}\" creator -site:business.instagram.com -site:help.instagram.com`,
    count: '20',
    setlang: 'en-US',
    // Without an explicit market Bing may return a local dictionary/search
    // page for a broad English category rather than the requested site results.
    cc: 'us',
    setmkt: 'en-US',
  });
  return `https://www.bing.com/search?${params}`;
}

async function fetchSearchPage(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response?.ok) {
    const error = new Error('Public discovery search failed');
    error.code = Number(response?.status) === 429 ? 'PUBLIC_DISCOVERY_THROTTLED' : 'PUBLIC_DISCOVERY_SEARCH_FAILED';
    throw error;
  }
  return response.text();
}

async function runInstagramPublicDiscovery(options = {}) {
  if (!options.databaseManager || typeof options.databaseManager.getRepository !== 'function') {
    throw new TypeError('databaseManager.getRepository is required');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const waitFor = typeof options.waitFor === 'function' ? options.waitFor : wait;
  const maxResultsPerSeed = Math.min(Math.max(Number(options.maxResultsPerSeed) || DEFAULT_RESULTS_PER_SEED, 1), 20);
  const seedGapMs = Math.max(Number(options.seedGapMs) || DEFAULT_SEED_GAP_MS, 500);
  const seeds = Array.isArray(options.seeds) && options.seeds.length ? options.seeds : DEFAULT_DISCOVERY_SEEDS;
  const repository = await options.databaseManager.getRepository('instagram');
  const taskId = options.taskId || `instagram-public-${crypto.randomUUID()}`;
  const jobId = await repository.createScrapeJob({
    platformId: 'instagram', shopRegion: text(options.region || 'GLOBAL').toUpperCase(),
    collection: 'public-search', mode: 'public_discovery', requestedSeeds: seeds.length,
  });
  const persistence = new CreatorPersistence({ repository, platformId: 'instagram' });
  const metrics = options.metrics || new CollectionRunMetrics({ now: options.now });
  const seen = new Set();
  const checkpoints = [];
  const searchDiagnostics = [];
  try {
    for (const [seedIndex, seed] of seeds.entries()) {
      const keyword = text(seed.keyword);
      const category = text(seed.category);
      onProgress({ state: 'discovering_public', completedSeeds: seedIndex, totalSeeds: seeds.length, keyword, category });
      const sourceUrl = bingSearchUrl(keyword);
      const html = await fetchSearchPage(sourceUrl, fetchImpl);
      const candidates = extractInstagramCandidates(html).slice(0, maxResultsPerSeed);
      const diagnostic = searchPageDiagnostics(html, candidates);
      searchDiagnostics.push(diagnostic);
      if (diagnostic.possibleVerificationPage) {
        const error = new Error('Public discovery search requires verification');
        error.code = 'PUBLIC_DISCOVERY_VERIFICATION_REQUIRED';
        error.searchDiagnostic = diagnostic;
        throw error;
      }
      const savedBefore = checkpoints.length;
      for (const candidate of candidates) {
        if (seen.has(candidate.handle)) continue;
        seen.add(candidate.handle);
        const checkpoint = await persistence.persistItem({
          type: 'item', taskId, seq: checkpoints.length + 1,
          payload: {
            nativeId: `instagram:${candidate.handle}`,
            handle: candidate.handle,
            profileUrl: candidate.profileUrl,
            category,
            verticalCategory: category,
            discoveryStage: 'public_candidate',
            verificationStatus: 'pending_local_profile_check',
            sourceKeyword: keyword,
            sourceEvidenceUrl: candidate.sourceUrl,
            collectionSource: 'public_search',
          },
        }, {
          region: text(options.region || 'GLOBAL').toUpperCase(), jobId,
          discoveryMetadata: discoveryMetadata({ mode: 'public_discovery', keyword, category, source: 'search_engine_public_result' }),
        });
        checkpoints.push(checkpoint);
        onProgress({ state: 'discovering_public', completedSeeds: seedIndex, totalSeeds: seeds.length, keyword, category, handle: candidate.handle, saved: checkpoints.length });
      }
      // This metric is about successful category requests, not whether a
      // search engine happened to expose a matching profile. A valid empty
      // result must remain visible as zero candidates rather than a failed
      // request, otherwise reliability reports are misleading.
      metrics.recordSuccess({ saved: checkpoints.length - savedBefore });
      if (seedIndex < seeds.length - 1) {
        onProgress({ state: 'waiting', completedSeeds: seedIndex + 1, totalSeeds: seeds.length, keyword, category, nextDelayMs: seedGapMs });
        await waitFor(seedGapMs);
      }
    }
    const database = checkpoints.reduce((total, checkpoint) => ({
      saved: total.saved + 1,
      inserted: total.inserted + checkpoint.payload.inserted,
      updated: total.updated + checkpoint.payload.updated,
    }), { saved: 0, inserted: 0, updated: 0 });
    const result = { ok: true, mode: 'public_discovery', creators: database.saved, database, metrics: metrics.summary(), searchDiagnostics };
    await repository.finishScrapeJob(jobId, result);
    return result;
  } catch (error) {
    metrics.recordFailure();
    const result = { ok: false, mode: 'public_discovery', creators: checkpoints.length, database: { saved: checkpoints.length }, error: error.code || 'PUBLIC_DISCOVERY_FAILED', metrics: metrics.summary(), searchDiagnostics };
    await repository.finishScrapeJob(jobId, result).catch(() => {});
    throw error;
  }
}

module.exports = {
  DEFAULT_RESULTS_PER_SEED,
  DEFAULT_SEED_GAP_MS,
  canonicalInstagramHandle,
  unwrapBingUrl,
  extractInstagramCandidates,
  searchPageDiagnostics,
  bingSearchUrl,
  runInstagramPublicDiscovery,
};
