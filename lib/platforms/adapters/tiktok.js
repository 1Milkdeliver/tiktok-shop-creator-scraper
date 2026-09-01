'use strict';

const { EventEmitter } = require('events');
const { validateNativeId, validateStructuredEvent } = require('../contract');

const TIKTOK_ADAPTER_ERROR_CODES = Object.freeze({
  INVALID_TASK_CONFIG: 'TIKTOK_INVALID_TASK_CONFIG',
  COLLECTOR_UNAVAILABLE: 'TIKTOK_COLLECTOR_UNAVAILABLE',
  TASK_ALREADY_RUNNING: 'TIKTOK_TASK_ALREADY_RUNNING',
});

class TikTokAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TikTokAdapterError';
    this.code = code;
  }
}

function asText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeHandle(value) {
  return asText(value).replace(/^@+/, '');
}

function firstText(...values) {
  return values.map(asText).find(Boolean) || '';
}

function validateTaskConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TikTokAdapterError(TIKTOK_ADAPTER_ERROR_CODES.INVALID_TASK_CONFIG, 'TikTok task config must be an object');
  }
  const query = asText(config.query || config.keyword);
  const handles = Array.isArray(config.handles) ? config.handles.map(normalizeHandle).filter(Boolean) : [];
  if (!query && !handles.length) {
    throw new TikTokAdapterError(TIKTOK_ADAPTER_ERROR_CODES.INVALID_TASK_CONFIG, 'TikTok discovery needs a query or at least one handle');
  }
  if (config.limit !== undefined && (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 10000)) {
    throw new TikTokAdapterError(TIKTOK_ADAPTER_ERROR_CODES.INVALID_TASK_CONFIG, 'TikTok task limit must be an integer between 1 and 10000');
  }
  return { ...config, query, handles, limit: config.limit === undefined ? 100 : config.limit };
}

// This is deliberately conservative: it maps only text/numeric discovery
// fields into the existing repository shape and leaves all browser/network work
// to an injected collector. No public TikTok endpoint is called here.
function normalizeCreatorCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('TikTok creator candidate must be an object');
  }
  const handle = normalizeHandle(firstText(candidate.handle, candidate.uniqueId, candidate.username));
  const nativeId = firstText(candidate.nativeId, candidate.id, candidate.userId, candidate.secUid, handle);
  validateNativeId(nativeId, 'candidate native ID');
  const categories = Array.isArray(candidate.categories) ? candidate.categories : [];
  const verticalCategories = Array.isArray(candidate.verticalCategories) ? candidate.verticalCategories : [];
  return {
    creator_oecuid: nativeId,
    handle,
    nickname: firstText(candidate.nickname, candidate.displayName, candidate.name),
    category: firstText(candidate.category, categories.join(' | ')),
    垂直类目: firstText(candidate.verticalCategory, candidate.niche, verticalCategories.join(' | ')),
    follower_cnt: candidate.followerCount ?? candidate.followers ?? candidate.follower_cnt ?? null,
    简介: firstText(candidate.bio, candidate.description),
    合作邮箱: firstText(candidate.contactEmail, candidate.email),
    profile_url: firstText(candidate.profileUrl, candidate.url),
    platform: 'tiktok',
    source: 'public_tiktok',
  };
}

class TikTokAdapter extends EventEmitter {
  constructor({ collector, browserFactory } = {}) {
    super();
    this.platformId = 'tiktok';
    this.taskCapabilities = ['creator_discovery', 'creator_profile', 'creator_export'];
    this.collector = collector;
    this.browserFactory = browserFactory;
    this.state = 'idle';
    this.controller = null;
    this.activeCollector = null;
    this.browser = null;
    this.savedCandidates = [];
  }

  validateNativeId(nativeId) { return validateNativeId(nativeId); }
  validateEvent(event) { return validateStructuredEvent(event, this.platformId); }

  _publish(type, data = {}, nativeId) {
    const event = { platformId: this.platformId, type, data, at: new Date().toISOString() };
    if (nativeId) event.nativeId = nativeId;
    this.validateEvent(event);
    this.emit('event', event);
    this.emit(type, event);
    return event;
  }

  _resolveCollector() {
    const collector = typeof this.collector === 'function' ? { collect: this.collector } : this.collector;
    if (!collector || typeof collector.collect !== 'function') {
      throw new TikTokAdapterError(TIKTOK_ADAPTER_ERROR_CODES.COLLECTOR_UNAVAILABLE, 'TikTok adapter requires an injected collector with collect(config, context)');
    }
    return collector;
  }

  async start(config) {
    if (this.controller) throw new TikTokAdapterError(TIKTOK_ADAPTER_ERROR_CODES.TASK_ALREADY_RUNNING, 'TikTok task is already running');
    const taskConfig = validateTaskConfig(config);
    const collector = this._resolveCollector();
    this.controller = new AbortController();
    this.activeCollector = collector;
    this.savedCandidates = [];
    this.state = 'running';
    this._publish('status', { state: 'running' });
    try {
      this.browser = this.browserFactory ? await this.browserFactory({ platformId: this.platformId, signal: this.controller.signal }) : null;
      const context = {
        signal: this.controller.signal,
        browser: this.browser,
        onCandidate: async candidate => this._acceptCandidate(candidate),
        onProgress: progress => this._publish('progress', { ...progress, state: this.state }),
      };
      const result = await collector.collect(taskConfig, context);
      // A collector may choose either streaming callbacks or a final array.
      const candidates = Array.isArray(result) ? result : (Array.isArray(result?.candidates) ? result.candidates : []);
      for (const candidate of candidates) await context.onCandidate(candidate);
      const summary = { state: this.controller.signal.aborted ? 'stopped' : 'done', discovered: this.savedCandidates.length };
      this.state = summary.state;
      this._publish('result', summary);
      this._publish('status', summary);
      return { ...summary, creators: this.savedCandidates };
    } catch (error) {
      if (this.controller?.signal.aborted) {
        const summary = { state: 'stopped', discovered: this.savedCandidates.length };
        this.state = 'stopped';
        this._publish('status', summary);
        return { ...summary, creators: this.savedCandidates };
      }
      this.state = 'error';
      this._publish('error', { code: error.code || 'TIKTOK_COLLECTION_FAILED', message: error.message });
      throw error;
    } finally {
      await this._closeBrowser();
      this.controller = null;
      this.activeCollector = null;
    }
  }

  async _acceptCandidate(candidate) {
    if (this.controller?.signal.aborted) return null;
    while (this.state === 'paused' && !this.controller.signal.aborted) {
      await new Promise(resolve => this.once('_resumed', resolve));
    }
    if (this.controller.signal.aborted) return null;
    const row = normalizeCreatorCandidate(candidate);
    this.savedCandidates.push(row);
    this._publish('progress', { discovered: this.savedCandidates.length, state: this.state }, row.creator_oecuid);
    return row;
  }

  pause() {
    if (!this.controller || this.state !== 'running') return false;
    this.state = 'paused';
    this.activeCollector?.pause?.();
    this._publish('status', { state: 'paused' });
    return true;
  }

  resume() {
    if (!this.controller || this.state !== 'paused') return false;
    this.state = 'running';
    this.activeCollector?.resume?.();
    this.emit('_resumed');
    this._publish('status', { state: 'running' });
    return true;
  }

  stop() {
    if (!this.controller) return false;
    this.state = 'stopped';
    this.activeCollector?.stop?.();
    this.controller.abort();
    this.emit('_resumed');
    this._publish('status', { state: 'stopped' });
    return true;
  }

  async _closeBrowser() {
    const browser = this.browser;
    this.browser = null;
    if (browser && typeof browser.close === 'function') await browser.close();
  }
}

function createTikTokAdapter(options) {
  return new TikTokAdapter(options);
}

module.exports = {
  TikTokAdapter,
  TikTokAdapterError,
  TIKTOK_ADAPTER_ERROR_CODES,
  validateTaskConfig,
  normalizeCreatorCandidate,
  createTikTokAdapter,
};
