'use strict';

const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { findChrome } = require('../browser');
const { CreatorPersistence } = require('./creator-persistence');
const { CollectionRunMetrics } = require('./collection-run-metrics');
const {
  readSessionCookies, canonicalInstagramHandle, isInstagramSessionAttentionUrl, sessionAttentionError,
  isTransientNavigationStatus, DEFAULT_NAVIGATION_RETRY_DELAYS_MS,
} = require('./instagram-headless-discovery');

const DEFAULT_PROFILE_GAP_MS = 45_000;
const DEFAULT_PROFILE_NAVIGATION_RETRY_DELAYS_MS = DEFAULT_NAVIGATION_RETRY_DELAYS_MS;
const MAX_HANDLES = 50;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => value === undefined || value === null ? '' : String(value).trim();

function normalizeHandle(value) {
  const raw = text(value);
  if (/^https?:\/\//i.test(raw)) return canonicalInstagramHandle(raw);
  return canonicalInstagramHandle(`https://www.instagram.com/${raw.replace(/^@/, '').replace(/\/$/, '')}/`);
}

function normalizeHandles(values) {
  const seen = new Set();
  const handles = [];
  for (const value of Array.isArray(values) ? values : []) {
    const handle = normalizeHandle(value);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
    if (handles.length >= MAX_HANDLES) break;
  }
  return handles;
}

function profileUrl(handle) {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

function parseProfileCounts(description) {
  const source = text(description);
  const read = (...labels) => {
    for (const label of labels) {
      const match = source.match(new RegExp(`([\\d.,]+\\s*[KMB万亿]?)\\s*${label}`, 'i'));
      if (match) return match[1].replace(/\s/g, '');
    }
    return '';
  };
  return {
    followers: read('Followers?', '位?粉丝', '关注者'),
    following: read('Following', '关注中'),
    mediaCount: read('Posts?', '帖子', '贴文'),
  };
}

function parseFollowerCount(description) {
  return parseProfileCounts(description).followers;
}

function extractPublicEmail(visibleText) {
  const email = text(visibleText).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || '';
  return email.length <= 254 ? email : '';
}

function profileHeaderText(visibleText) {
  // Instagram's profile header is the only part used for profile fields. This
  // keeps captions/comments out of the saved bio and contact scan.
  return text(visibleText).split(/\n{2,}/)[0] || text(visibleText).slice(0, 4_000);
}

function normalizePublicLink(value) {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function parseProfileSnapshot({ handle, title, description, visibleText, headerText, accessibleText, externalLink, isVerified, profileCategory }) {
  const canonicalHandle = normalizeHandle(handle);
  const titleText = text(title);
  const displayName = titleText.match(/^(.*?)\s*\(@[^)]+\)/)?.[1]?.trim() || canonicalHandle;
  const publicHeader = text(headerText || profileHeaderText(visibleText));
  const email = extractPublicEmail(publicHeader);
  // Instagram varies this placement by locale and rollout: some profiles put
  // counts in the meta description, others only in the visible header.
  const counts = parseProfileCounts(`${text(description)}\n${publicHeader}\n${text(accessibleText)}`);
  const bioLines = publicHeader.split(/\n+/).map(text).filter(Boolean)
    .filter(line => !/^\d[\d.,KMB]*\s+(Followers|Following|Posts?)$/i.test(line))
    .filter(line => line !== `@${canonicalHandle}` && line !== canonicalHandle)
    .filter(line => line !== titleText);
  const bio = bioLines.slice(0, 8).join('\n').slice(0, 2_000);
  return {
    nativeId: `instagram:${canonicalHandle}`,
    handle: `@${canonicalHandle}`,
    displayName,
    profileUrl: profileUrl(canonicalHandle),
    followers: counts.followers,
    following: counts.following,
    mediaCount: counts.mediaCount,
    biography: bio,
    externalLink: normalizePublicLink(externalLink),
    isVerified: isVerified === true ? 'verified' : 'unverified',
    profileCategory: text(profileCategory),
    contact: email ? { email } : {},
    source: 'instagram-browser-public-profile',
    discoveryStage: 'browser_profile_checked',
    verificationStatus: 'browser_profile_checked',
    collectionSource: 'instagram_browser_profile',
    ...(email ? { emailProvenance: 'instagram:visible-browser-profile' } : {}),
    bioProvenance: bio ? 'instagram:visible-browser-profile' : '',
    externalLinkProvenance: externalLink ? 'instagram:visible-browser-profile' : '',
    profileCategoryProvenance: profileCategory ? 'instagram:visible-browser-profile' : '',
    profileVerifiedAt: new Date().toISOString(),
  };
}

async function launchBrowser(mode = 'headless', options = {}) {
  const executablePath = options.executablePath || findChrome();
  if (!executablePath) {
    const error = new Error('Chrome is unavailable');
    error.code = 'CHROME_UNAVAILABLE';
    throw error;
  }
  const realWindow = mode === 'real';
  return puppeteer.launch({
    executablePath,
    headless: realWindow ? false : 'new',
    args: ['--no-first-run', '--no-default-browser-check', ...(realWindow ? ['--window-size=1200,900'] : [])],
    defaultViewport: realWindow ? null : undefined,
    protocolTimeout: 30_000,
  });
}

function profileNavigationError(cause) {
  const error = new Error('Instagram browser profile had a temporary navigation failure');
  error.code = 'INSTAGRAM_PROFILE_TRANSIENT_FAILURE';
  error.stage = 'browser_profile_loading';
  error.retryable = true;
  error.cause = cause;
  return error;
}

function profileAccessAttentionError(stage, hasSession) {
  if (hasSession) return sessionAttentionError(stage);
  const error = new Error('Instagram public profile is temporarily unavailable without a session');
  error.code = 'INSTAGRAM_PUBLIC_PROFILE_ATTENTION_REQUIRED';
  error.stage = stage;
  return error;
}

async function loadProfilePage({ page, handle, onProgress, waitFor, retryDelaysMs, browserMode, hasSession = true }) {
  const attempts = [0, ...(Array.isArray(retryDelaysMs) ? retryDelaysMs : DEFAULT_PROFILE_NAVIGATION_RETRY_DELAYS_MS)];
  let lastError = null;
  for (const [attempt, delay] of attempts.entries()) {
    if (attempt > 0) {
      onProgress({ state: 'recovering', phase: 'browser_profile_navigation_retry', handle: `@${handle}`, retryAttempt: attempt, retryDelayMs: delay, browserMode });
      await waitFor(delay);
    }
    try {
      const response = await page.goto(profileUrl(handle), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = Number(response?.status?.() || 0);
      if (status === 401 || status === 403 || isInstagramSessionAttentionUrl(typeof page.url === 'function' ? page.url() : '')) {
        throw profileAccessAttentionError('browser_profile_loading', hasSession);
      }
      if (status === 429) {
        const error = new Error('Instagram browser profile collection was throttled');
        error.code = 'THROTTLED';
        error.stage = 'browser_profile_loading';
        throw error;
      }
      if (!status || isTransientNavigationStatus(status)) {
        lastError = profileNavigationError(`HTTP_${status || 'NO_RESPONSE'}`);
        continue;
      }
      if (status >= 400) {
        const error = new Error('Instagram browser profile did not load');
        error.code = 'INSTAGRAM_BROWSER_PROFILE_FAILED';
        error.stage = 'browser_profile_loading';
        throw error;
      }
      return response;
    } catch (error) {
      if (error?.code === 'THROTTLED' || error?.code === 'INSTAGRAM_BROWSER_PROFILE_FAILED' || error?.code === 'INSTAGRAM_SESSION_ATTENTION_REQUIRED' || error?.code === 'INSTAGRAM_PUBLIC_PROFILE_ATTENTION_REQUIRED') throw error;
      lastError = error?.retryable ? error : profileNavigationError(error?.code || 'NAVIGATION_ERROR');
    }
  }
  throw lastError || profileNavigationError('NAVIGATION_ERROR');
}

async function runInstagramBrowserProfileCollection(options = {}) {
  if (!options.databaseManager || typeof options.databaseManager.getRepository !== 'function') throw new TypeError('databaseManager.getRepository is required');
  const handles = normalizeHandles(options.handles);
  if (!handles.length) {
    const error = new Error('At least one Instagram handle is required');
    error.code = 'INSTAGRAM_HANDLE_REQUIRED';
    throw error;
  }
  const mode = options.browserMode === 'real' ? 'real' : 'headless';
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const waitFor = typeof options.waitFor === 'function' ? options.waitFor : wait;
  const createBrowser = options.createBrowser || (() => launchBrowser(mode));
  const profileGapMs = Math.max(Number(options.profileGapMs) || DEFAULT_PROFILE_GAP_MS, 5_000);
  const navigationRetryDelaysMs = Array.isArray(options.navigationRetryDelaysMs)
    ? options.navigationRetryDelaysMs.map(Number).filter(delay => Number.isFinite(delay) && delay >= 1_000).slice(0, 2)
    : DEFAULT_PROFILE_NAVIGATION_RETRY_DELAYS_MS;
  const region = text(options.region || 'GLOBAL').toUpperCase();
  const cookies = options.cookies || readSessionCookies(options.sessionStatePath, options.stateRoot);
  const repository = await options.databaseManager.getRepository('instagram');
  const taskId = options.taskId || `instagram-browser-profile-${crypto.randomUUID()}`;
  const jobId = await repository.createScrapeJob({ platformId: 'instagram', shopRegion: region, collection: 'browser-profile', mode: `browser_${mode}_profile`, requestedHandles: handles.length });
  const persistence = new CreatorPersistence({ repository, platformId: 'instagram' });
  const metrics = options.metrics || new CollectionRunMetrics({ now: options.now });
  const checkpoints = [];
  let browser;
  try {
    browser = await createBrowser();
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    for (const [index, handle] of handles.entries()) {
      onProgress({ state: 'running', phase: 'browser_profile_loading', completed: index, total: handles.length, handle: `@${handle}`, browserMode: mode });
      await loadProfilePage({ page, handle, onProgress, waitFor, retryDelaysMs: navigationRetryDelaysMs, browserMode: mode, hasSession: cookies.length > 0 });
      await waitFor(Math.min(3_000, Math.max(0, Number(options.pageSettleMs) || 1_500)));
      const snapshot = await page.evaluate(() => {
        const header = document.querySelector('header') || document.querySelector('main header');
        const firstExternalLink = [...(header || document).querySelectorAll('a[href]')]
          .map(anchor => anchor.href || '')
          .find(href => /^https?:\/\//i.test(href) && !/https?:\/\/(?:www\.)?instagram\.com\//i.test(href)) || '';
        const headerText = header?.innerText || '';
        const accessibleText = [...(header || document).querySelectorAll('[aria-label], [title]')]
          .map(element => element.getAttribute('aria-label') || element.getAttribute('title') || '')
          .join('\n');
        const category = [...(header || document).querySelectorAll('span, div')]
          .map(element => element.textContent?.trim() || '')
          .find(value => /^(Digital creator|Personal blog|Entrepreneur|Public figure|Shopping & retail|Product\/service)$/i.test(value)) || '';
        return {
        title: document.title || '',
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '',
        // Only the first visible part of a user-visible profile page is used
        // for public-contact detection. No cookies, network data, or hidden
        // state are accessed.
        visibleText: (document.body?.innerText || '').slice(0, 20_000),
        headerText,
        accessibleText,
        externalLink: firstExternalLink,
        isVerified: Boolean((header || document).querySelector('svg[aria-label*="Verified" i], svg[title*="Verified" i]')),
        profileCategory: category,
      };
      });
      const creator = {
        ...parseProfileSnapshot({ handle, ...snapshot }),
        // The public no-Cookie route is a distinct collection provenance. It
        // has the same visible-field parser, but must never be presented as
        // an authenticated browser session in filters or exports.
        collectionSource: text(options.collectionSource) || 'instagram_browser_profile',
      };
      const checkpoint = await persistence.persistItem({ type: 'item', taskId, seq: checkpoints.length + 1, payload: creator }, {
        region, jobId, discoveryMetadata: options.discoveryMetadata || { collection_mode: 'browser_profile_refresh', discovery_source: 'user_handle_list', source_keyword: '', keyword_category: '' },
      });
      checkpoints.push(checkpoint);
      metrics.recordSuccess({ saved: checkpoint.payload.inserted + checkpoint.payload.updated });
      onProgress({ state: 'running', phase: 'browser_profile_saved', completed: index + 1, total: handles.length, handle: `@${handle}`, browserMode: mode, saved: checkpoints.length });
      if (index < handles.length - 1) {
        onProgress({ state: 'waiting', phase: 'profile_gap', completed: index + 1, total: handles.length, nextDelayMs: profileGapMs, browserMode: mode });
        await waitFor(profileGapMs);
      }
    }
    const database = checkpoints.reduce((total, checkpoint) => ({ saved: total.saved + 1, inserted: total.inserted + checkpoint.payload.inserted, updated: total.updated + checkpoint.payload.updated }), { saved: 0, inserted: 0, updated: 0 });
    const result = { ok: true, mode: `browser_${mode}_profile`, creators: database.saved, database, metrics: metrics.summary() };
    await repository.finishScrapeJob(jobId, result);
    return result;
  } catch (error) {
    metrics.recordFailure();
    await repository.finishScrapeJob(jobId, { ok: false, creators: checkpoints.length, database: { saved: checkpoints.length }, error: error.code || 'INSTAGRAM_BROWSER_PROFILE_FAILED', metrics: metrics.summary() }).catch(() => {});
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}

module.exports = {
  DEFAULT_PROFILE_GAP_MS, DEFAULT_PROFILE_NAVIGATION_RETRY_DELAYS_MS, normalizeHandle, normalizeHandles, profileUrl, parseProfileCounts, parseFollowerCount,
  extractPublicEmail, profileHeaderText, normalizePublicLink, parseProfileSnapshot, launchBrowser, profileNavigationError, profileAccessAttentionError, loadProfilePage, runInstagramBrowserProfileCollection,
};
