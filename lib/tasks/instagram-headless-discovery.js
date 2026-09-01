'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { findChrome } = require('../browser');
const { DEFAULT_DISCOVERY_SEEDS, discoveryMetadata } = require('../discovery/ecommerce-defaults');
const { CreatorPersistence } = require('./creator-persistence');
const { CollectionRunMetrics } = require('./collection-run-metrics');

// A deliberately small browser batch.  Automatic discovery reads only the
// result page for one keyword; it does not open profiles, follower graphs, or
// any detail endpoints.
const DEFAULT_RESULTS_PER_SEED = 10;
// Validated with a three-seed browser-session acceptance check. Keep this
// deliberately conservative: sustained coverage favors recoverability over
// maximizing request volume.
const DEFAULT_SEED_GAP_MS = 75_000;
const DEFAULT_NAVIGATION_RETRY_DELAYS_MS = Object.freeze([15_000, 45_000]);
const RESERVED_PATHS = new Set(['accounts', 'about', 'api', 'challenge', 'developer', 'directory', 'explore', 'legal', 'p', 'reel', 'reels', 'stories', 'tv', 'web']);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => value === undefined || value === null ? '' : String(value).trim();

function canonicalInstagramHandle(value) {
  try {
    const url = new URL(value, 'https://www.instagram.com');
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return '';
    const handle = text(url.pathname.split('/').filter(Boolean)[0]).replace(/^@/, '').toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(handle) && !RESERVED_PATHS.has(handle) ? handle : '';
  } catch (_) {
    return '';
  }
}

function extractInstagramProfileCandidates(hrefs) {
  const seen = new Set();
  const candidates = [];
  for (const href of Array.isArray(hrefs) ? hrefs : []) {
    const handle = canonicalInstagramHandle(href);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    candidates.push({ handle, profileUrl: `https://www.instagram.com/${handle}/` });
  }
  return candidates;
}

function browserSearchUrl(keyword) {
  return `https://www.instagram.com/explore/tags/${encodeURIComponent(text(keyword))}/`;
}

async function collectProfileCandidates(page, { maxResults, scrollPasses = 0, scrollSettleMs = 1_500, waitFor = wait } = {}) {
  const limit = Math.max(1, Number(maxResults) || DEFAULT_RESULTS_PER_SEED);
  const passes = Math.min(Math.max(Number(scrollPasses) || 0, 0), 3);
  const hrefs = new Set();
  for (let pass = 0; pass <= passes; pass += 1) {
    const pageHrefs = await page.$$eval('a[href]', links => links.map(link => link.getAttribute('href') || ''));
    for (const href of pageHrefs) hrefs.add(href);
    if (extractInstagramProfileCandidates([...hrefs]).length >= limit || pass === passes || typeof page.evaluate !== 'function') break;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await waitFor(Math.min(5_000, Math.max(0, Number(scrollSettleMs) || 1_500)));
  }
  return extractInstagramProfileCandidates([...hrefs]).slice(0, limit);
}

function isInstagramSessionAttentionUrl(value) {
  try {
    const url = new URL(value, 'https://www.instagram.com');
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return false;
    return /\/(?:accounts\/login|challenge|checkpoint)(?:\/|$)/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function sessionAttentionError(stage) {
  const error = new Error('Instagram session needs attention');
  error.code = 'INSTAGRAM_SESSION_ATTENTION_REQUIRED';
  error.stage = stage;
  return error;
}

function readSessionCookies(sessionStatePath, stateRoot) {
  if (!sessionStatePath || !stateRoot) {
    const error = new Error('Instagram browser session is unavailable');
    error.code = 'SOCIAL_ACCOUNT_STATE_MISSING';
    throw error;
  }
  let resolvedRoot;
  let resolvedSession;
  try {
    resolvedRoot = path.resolve(stateRoot);
    resolvedSession = path.resolve(sessionStatePath);
    if (path.relative(resolvedRoot, resolvedSession).startsWith('..') || !fs.statSync(resolvedSession).isFile()) throw new Error('untrusted state path');
    const settings = JSON.parse(fs.readFileSync(resolvedSession, 'utf8'));
    const source = settings && typeof settings.cookies === 'object' ? settings.cookies : {};
    const cookies = Object.entries(source)
      .filter(([name, value]) => /^[A-Za-z0-9_]+$/.test(name) && typeof value === 'string' && value)
      .map(([name, value]) => ({ name, value, domain: '.instagram.com', path: '/', secure: true }));
    if (!cookies.length) throw new Error('missing cookies');
    return cookies;
  } catch (_) {
    const error = new Error('Instagram browser session is unavailable');
    error.code = 'SOCIAL_ACCOUNT_STATE_MISSING';
    throw error;
  }
}

async function launchIsolatedHeadlessBrowser(options = {}) {
  const executablePath = options.executablePath || findChrome();
  if (!executablePath) {
    const error = new Error('Chrome is unavailable');
    error.code = 'CHROME_UNAVAILABLE';
    throw error;
  }
  // Do not reuse the personal Chrome profile or suppress browser automation
  // signals.  This is an isolated, ordinary Headless Chrome session.
  return puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check'],
    protocolTimeout: 30_000,
  });
}

function isTransientNavigationStatus(status) {
  return status === 408 || status === 425 || status === 502 || status === 503 || status === 504;
}

function transientDiscoveryError(stage, cause) {
  const error = new Error('Instagram browser discovery had a temporary navigation failure');
  error.code = 'INSTAGRAM_TRANSIENT_FAILURE';
  error.stage = stage;
  error.retryable = true;
  error.cause = cause;
  return error;
}

async function loadSeedPage({ page, keyword, onProgress, waitFor, retryDelaysMs }) {
  const attempts = [0, ...(Array.isArray(retryDelaysMs) ? retryDelaysMs : DEFAULT_NAVIGATION_RETRY_DELAYS_MS)];
  let lastError = null;
  for (const [attempt, delay] of attempts.entries()) {
    if (attempt > 0) {
      onProgress({ state: 'recovering', phase: 'browser_navigation_retry', keyword, retryAttempt: attempt, retryDelayMs: delay });
      await waitFor(delay);
    }
    try {
      const response = await page.goto(browserSearchUrl(keyword), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = Number(response?.status?.() || 0);
      if (status === 401 || status === 403 || isInstagramSessionAttentionUrl(typeof page.url === 'function' ? page.url() : '')) {
        throw sessionAttentionError('browser_candidate_search');
      }
      if (status === 429) {
        const error = new Error('Instagram browser discovery was throttled');
        error.code = 'THROTTLED';
        error.stage = 'browser_candidate_search';
        throw error;
      }
      if (!status || isTransientNavigationStatus(status)) {
        lastError = transientDiscoveryError('browser_candidate_search', `HTTP_${status || 'NO_RESPONSE'}`);
        continue;
      }
      if (status >= 400) {
        const error = new Error('Instagram browser discovery did not load');
        error.code = 'INSTAGRAM_BROWSER_DISCOVERY_FAILED';
        error.stage = 'browser_candidate_search';
        throw error;
      }
      return response;
    } catch (error) {
      if (error?.code === 'THROTTLED' || error?.code === 'INSTAGRAM_BROWSER_DISCOVERY_FAILED' || error?.code === 'INSTAGRAM_SESSION_ATTENTION_REQUIRED') throw error;
      lastError = error?.retryable ? error : transientDiscoveryError('browser_candidate_search', error?.code || 'NAVIGATION_ERROR');
    }
  }
  throw lastError || transientDiscoveryError('browser_candidate_search', 'NAVIGATION_ERROR');
}

async function runInstagramHeadlessDiscovery(options = {}) {
  if (!options.databaseManager || typeof options.databaseManager.getRepository !== 'function') throw new TypeError('databaseManager.getRepository is required');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const waitFor = typeof options.waitFor === 'function' ? options.waitFor : wait;
  const createBrowser = options.createBrowser || launchIsolatedHeadlessBrowser;
  const seeds = Array.isArray(options.seeds) && options.seeds.length ? options.seeds : DEFAULT_DISCOVERY_SEEDS;
  const maxResultsPerSeed = Math.min(Math.max(Number(options.maxResultsPerSeed) || DEFAULT_RESULTS_PER_SEED, 1), 20);
  const seedGapMs = Math.max(Number(options.seedGapMs) || DEFAULT_SEED_GAP_MS, 5_000);
  const navigationRetryDelaysMs = Array.isArray(options.navigationRetryDelaysMs)
    ? options.navigationRetryDelaysMs.map(Number).filter(delay => Number.isFinite(delay) && delay >= 1_000).slice(0, 2)
    : DEFAULT_NAVIGATION_RETRY_DELAYS_MS;
  const region = text(options.region || 'GLOBAL').toUpperCase();
  const cookies = options.cookies || readSessionCookies(options.sessionStatePath, options.stateRoot);
  const repository = await options.databaseManager.getRepository('instagram');
  const taskId = options.taskId || `instagram-headless-${crypto.randomUUID()}`;
  const jobId = await repository.createScrapeJob({ platformId: 'instagram', shopRegion: region, collection: 'browser-search', mode: 'headless_candidate_discovery', requestedSeeds: seeds.length });
  const persistence = new CreatorPersistence({ repository, platformId: 'instagram' });
  const metrics = options.metrics || new CollectionRunMetrics({ now: options.now });
  const seen = new Set();
  const checkpoints = [];
  const discovery = {
    seeds: seeds.length,
    candidateLinks: 0,
    uniqueCandidates: 0,
    duplicateCandidates: 0,
    knownCandidates: 0,
    emptySeeds: 0,
  };
  let browser;
  try {
    browser = await createBrowser();
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    const knownCreatorIds = new Set([
      ...(Array.isArray(options.existingCreatorIds) ? options.existingCreatorIds : []),
      ...(typeof repository.getCreatorIds === 'function' ? await repository.getCreatorIds(region) : []),
    ].map(value => text(value)).filter(Boolean));
    for (const [seedIndex, seed] of seeds.entries()) {
      const keyword = text(seed.keyword);
      const category = text(seed.category);
      onProgress({ state: 'running', phase: 'browser_candidate_search', completedSeeds: seedIndex, totalSeeds: seeds.length, keyword, category });
      const response = await loadSeedPage({ page, keyword, onProgress, waitFor, retryDelaysMs: navigationRetryDelaysMs });
      await waitFor(Math.min(3_000, Math.max(0, Number(options.pageSettleMs) || 1_500)));
      const candidates = await collectProfileCandidates(page, {
        maxResults: maxResultsPerSeed,
        scrollPasses: options.candidateScrollPasses,
        scrollSettleMs: options.scrollSettleMs,
        waitFor,
      });
      discovery.candidateLinks += candidates.length;
      if (!candidates.length) discovery.emptySeeds += 1;
      const savedBefore = checkpoints.length;
      for (const candidate of candidates) {
        if (seen.has(candidate.handle)) {
          discovery.duplicateCandidates += 1;
          continue;
        }
        seen.add(candidate.handle);
        if (knownCreatorIds.has(`instagram:${candidate.handle}`)) {
          discovery.knownCandidates += 1;
          continue;
        }
        discovery.uniqueCandidates += 1;
        const checkpoint = await persistence.persistItem({
          type: 'item', taskId, seq: checkpoints.length + 1,
          payload: {
            nativeId: `instagram:${candidate.handle}`,
            handle: candidate.handle,
            profileUrl: candidate.profileUrl,
            category,
            verticalCategory: category,
            discoveryStage: 'browser_candidate',
            verificationStatus: 'pending_profile_check',
            sourceKeyword: keyword,
            sourceEvidenceUrl: page.url(),
            collectionSource: 'instagram_headless_search',
          },
        }, {
          region, jobId,
          discoveryMetadata: discoveryMetadata({ mode: 'headless_candidate_discovery', keyword, category, source: 'instagram_browser_search' }),
        });
        checkpoints.push(checkpoint);
        onProgress({ state: 'running', phase: 'candidate_saved', completedSeeds: seedIndex, totalSeeds: seeds.length, keyword, category, handle: candidate.handle, saved: checkpoints.length });
      }
      // Speed metrics must reflect unique candidates that reached the durable
      // checkpoint, not every link returned by Instagram's result page.
      metrics.recordSuccess({ saved: checkpoints.length - savedBefore });
      onProgress({ state: 'running', phase: 'browser_candidate_search', completedSeeds: seedIndex + 1, totalSeeds: seeds.length, keyword, category, saved: checkpoints.length });
      if (seedIndex < seeds.length - 1) {
        onProgress({ state: 'waiting', phase: 'seed_gap', completedSeeds: seedIndex + 1, totalSeeds: seeds.length, keyword, category, nextDelayMs: seedGapMs });
        await waitFor(seedGapMs);
      }
    }
    const database = checkpoints.reduce((total, checkpoint) => ({ saved: total.saved + 1, inserted: total.inserted + checkpoint.payload.inserted, updated: total.updated + checkpoint.payload.updated }), { saved: 0, inserted: 0, updated: 0 });
    const result = { ok: true, mode: 'headless_candidate_discovery', creators: database.saved, database, discovery, metrics: metrics.summary() };
    await repository.finishScrapeJob(jobId, result);
    return result;
  } catch (error) {
    metrics.recordFailure();
    const result = { ok: false, mode: 'headless_candidate_discovery', creators: checkpoints.length, database: { saved: checkpoints.length }, discovery, error: error.code || 'INSTAGRAM_BROWSER_DISCOVERY_FAILED', metrics: metrics.summary() };
    await repository.finishScrapeJob(jobId, result).catch(() => {});
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}

module.exports = {
  DEFAULT_RESULTS_PER_SEED, DEFAULT_SEED_GAP_MS, DEFAULT_NAVIGATION_RETRY_DELAYS_MS, canonicalInstagramHandle,
  extractInstagramProfileCandidates, browserSearchUrl, collectProfileCandidates, isInstagramSessionAttentionUrl, sessionAttentionError, readSessionCookies,
  launchIsolatedHeadlessBrowser, isTransientNavigationStatus, transientDiscoveryError, loadSeedPage, runInstagramHeadlessDiscovery,
};
