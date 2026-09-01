'use strict';

// Optional Hiker API enrichment.  This module deliberately accepts only an
// opaque API key from the Electron main process; callers never receive it and
// it is not placed in creator records, job results, logs, or progress events.
const crypto = require('node:crypto');
const { CreatorPersistence } = require('./creator-persistence');

const HIKER_BASE_URL = 'https://api.hikerapi.com';
const MAX_HANDLES_PER_RUN = 50;

function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }

function normalizeHandle(value) {
  const handle = text(value).replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return '';
  return handle;
}

function classifyHikerResponse(status) {
  if (status === 401 || status === 403) return { code: 'HIKER_AUTH_REQUIRED', classification: 'authentication', message: 'Hiker API key needs attention before collection can continue' };
  if (status === 429) return { code: 'HIKER_THROTTLED', classification: 'transient', message: 'Hiker temporarily throttled this collection' };
  if (status >= 500) return { code: 'HIKER_SERVICE_UNAVAILABLE', classification: 'transient', message: 'Hiker service is temporarily unavailable' };
  return { code: 'HIKER_REQUEST_FAILED', classification: 'transient', message: 'Hiker could not retrieve this public profile' };
}

class HikerInstagramCollectorError extends Error {
  constructor({ code, classification, message }) {
    super(message);
    this.name = 'HikerInstagramCollectorError';
    this.code = code;
    this.classification = classification;
  }
}

function unwrapProfile(response) {
  if (!response || typeof response !== 'object') return null;
  if (response.user && typeof response.user === 'object') return response.user;
  if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) return response.data;
  return response;
}

function normalizeHikerProfile(raw, requestedHandle) {
  const profile = unwrapProfile(raw);
  if (!profile) return null;
  const nativeId = text(profile.pk || profile.id || profile.user_id);
  const username = normalizeHandle(profile.username || profile.handle || requestedHandle);
  if (!nativeId || !username) return null;
  const publicEmail = text(profile.public_email || profile.business_email || profile.email);
  const category = text(profile.category_name || profile.category || profile.business_category_name);
  return {
    nativeId,
    displayName: text(profile.full_name || profile.fullName || username) || username,
    handle: `@${username}`,
    biography: text(profile.biography || profile.bio),
    profileUrl: `https://www.instagram.com/${username}/`,
    followers: profile.follower_count ?? profile.followers ?? profile.followers_count ?? null,
    mediaCount: profile.media_count ?? profile.posts_count ?? null,
    category,
    contact: publicEmail ? { email: publicEmail } : {},
    emailProvenance: publicEmail ? 'instagram:hiker:public-profile' : '',
    categoryProvenance: category ? 'instagram:hiker:public-profile' : '',
    source: 'hiker-api:public-profile',
  };
}

async function hikerGetProfile({ apiKey, handle, fetchImpl = globalThis.fetch, baseUrl = HIKER_BASE_URL }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new HikerInstagramCollectorError({ code: 'HIKER_API_KEY_REQUIRED', classification: 'permanent', message: 'Hiker API key is required' });
  if (typeof fetchImpl !== 'function') throw new HikerInstagramCollectorError({ code: 'HIKER_FETCH_UNAVAILABLE', classification: 'permanent', message: 'Hiker network client is unavailable' });
  const username = normalizeHandle(handle);
  if (!username) throw new HikerInstagramCollectorError({ code: 'HIKER_INVALID_HANDLE', classification: 'permanent', message: 'A valid Instagram handle is required' });
  let response;
  try {
    response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/v2/user/by/username?username=${encodeURIComponent(username)}`, {
      headers: { 'x-access-key': apiKey.trim(), accept: 'application/json' },
    });
  } catch (_) {
    throw new HikerInstagramCollectorError({ code: 'HIKER_NETWORK_ERROR', classification: 'transient', message: 'Unable to reach Hiker right now' });
  }
  if (!response || !response.ok) throw new HikerInstagramCollectorError(classifyHikerResponse(Number(response?.status || 0)));
  try { return await response.json(); }
  catch (_) { throw new HikerInstagramCollectorError({ code: 'HIKER_INVALID_RESPONSE', classification: 'transient', message: 'Hiker returned an unreadable profile response' }); }
}

async function runHikerInstagramProfileEnrichment(options = {}) {
  const handles = [...new Set((Array.isArray(options.handles) ? options.handles : []).map(normalizeHandle).filter(Boolean))].slice(0, MAX_HANDLES_PER_RUN);
  if (!handles.length) throw new HikerInstagramCollectorError({ code: 'HIKER_HANDLES_REQUIRED', classification: 'permanent', message: 'At least one Instagram handle is required' });
  if (!options.databaseManager || typeof options.databaseManager.getRepository !== 'function') throw new TypeError('databaseManager.getRepository is required');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const repository = await options.databaseManager.getRepository('instagram');
  const jobId = await repository.createScrapeJob({ platformId: 'instagram', shopRegion: 'GLOBAL', collection: 'hiker-api', mode: 'profile_enrichment', requestedHandles: handles.length });
  const persistence = new CreatorPersistence({ repository, platformId: 'instagram' });
  const checkpoints = [];
  try {
    for (const [index, handle] of handles.entries()) {
      const raw = await hikerGetProfile({ apiKey: options.apiKey, handle, fetchImpl: options.fetchImpl, baseUrl: options.baseUrl });
      const creator = normalizeHikerProfile(raw, handle);
      if (!creator) throw new HikerInstagramCollectorError({ code: 'HIKER_PROFILE_INVALID', classification: 'transient', message: 'Hiker returned a profile without a usable public identifier' });
      const checkpoint = await persistence.persistItem({ type: 'item', taskId: options.taskId || `hiker-instagram-${crypto.randomUUID()}`, seq: index + 1, payload: creator }, {
        region: 'GLOBAL', jobId, discoveryMetadata: options.discoveryMetadata || null,
      });
      checkpoints.push(checkpoint);
      onProgress({ platformId: 'instagram', provider: 'hiker', state: 'running', completed: index + 1, total: handles.length, handle: creator.handle, saved: checkpoints.length });
    }
    const database = checkpoints.reduce((sum, entry) => ({ saved: sum.saved + 1, inserted: sum.inserted + entry.payload.inserted, updated: sum.updated + entry.payload.updated }), { saved: 0, inserted: 0, updated: 0 });
    const result = { ok: true, provider: 'hiker', creators: checkpoints.length, database };
    await repository.finishScrapeJob(jobId, result);
    return result;
  } catch (error) {
    const result = { ok: false, provider: 'hiker', creators: checkpoints.length, database: { saved: checkpoints.length }, error: error.code || 'HIKER_COLLECTION_FAILED' };
    await repository.finishScrapeJob(jobId, result).catch(() => {});
    throw error;
  }
}

module.exports = { HIKER_BASE_URL, MAX_HANDLES_PER_RUN, HikerInstagramCollectorError, classifyHikerResponse, normalizeHikerProfile, hikerGetProfile, runHikerInstagramProfileEnrichment };
