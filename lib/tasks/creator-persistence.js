'use strict';

// Main-process persistence boundary for worker records.  A checkpoint is
// returned only after the repository transaction resolves, so callers can
// safely use it as a durable-resume marker.
class CreatorPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CreatorPersistenceError';
    this.code = code;
  }
}

const PERSISTENCE_ERROR_CODES = Object.freeze({
  INVALID_ITEM: 'INVALID_WORKER_ITEM',
  PERSIST_FAILED: 'WORKER_ITEM_PERSIST_FAILED',
});

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

// Worker records use platform-neutral names. Convert them once, immediately
// before the established CreatorDatabase repository writes the row.
function normalizeYouTubeCreator(creator) {
  const stats = creator.stats && typeof creator.stats === 'object' && !Array.isArray(creator.stats)
    ? creator.stats
    : {};
  return {
    ...creator,
    creator_oecuid: text(creator.creator_oecuid || creator.creatorId || creator.nativeId),
    handle: text(creator.handle),
    nickname: text(creator.nickname || creator.displayName),
    follower_cnt: creator.follower_cnt ?? creator.followerCount ?? stats.subscriberCount ?? null,
    units_sold: creator.units_sold ?? creator.videoCount ?? stats.videoCount ?? null,
    简介: text(creator['简介'] || creator.bio || creator.description),
    合作邮箱: text(creator['合作邮箱'] || creator.contactEmail || creator.email),
    platform: 'youtube',
  };
}

// X may derive a topical category from a public profile description and may
// surface an email that was explicitly public on that profile.  Keep the
// value provenance in raw_json, while mapping the display values into the
// established creator columns.  Runtime account-pool state is deliberately
// not accepted here: it belongs to the worker session, never a creator row.
function normalizeXCreator(creator) {
  const stats = creator.stats && typeof creator.stats === 'object' && !Array.isArray(creator.stats)
    ? creator.stats
    : {};
  const inferredCategory = text(creator.inferredCategory || creator.category);
  const contactEmail = text(creator.contactEmail || creator.publicEmail || creator.email);
  const normalized = {
    ...creator,
    creator_oecuid: text(creator.creator_oecuid || creator.creatorId || creator.nativeId),
    handle: text(creator.handle),
    nickname: text(creator.nickname || creator.displayName),
    follower_cnt: creator.follower_cnt ?? creator.followerCount ?? stats.followerCount ?? null,
    units_sold: creator.units_sold ?? creator.postCount ?? stats.postCount ?? null,
    简介: text(creator['简介'] || creator.bio || creator.description),
    合作邮箱: contactEmail,
    category: inferredCategory,
    垂直类目: inferredCategory,
    platform: 'x',
  };
  // Do not let a worker event accidentally turn account-pool bookkeeping into
  // stored creator data, even when an adapter is later replaced.
  delete normalized.accountPoolRef;
  delete normalized.accountState;
  return normalized;
}

// Instagram fixtures only expose contact details when they are public profile
// fields. Preserve that provenance in raw_json while mapping usable values to
// the established, platform-independent SQLite columns.
function normalizeInstagramCreator(creator) {
  const contact = creator.contact && typeof creator.contact === 'object' && !Array.isArray(creator.contact)
    ? creator.contact
    : {};
  const category = text(creator.category);
  const publicEmail = text(contact.email || creator.publicEmail || creator.contactEmail || creator.email);
  return {
    ...creator,
    creator_oecuid: text(creator.creator_oecuid || creator.creatorId || creator.nativeId),
    handle: text(creator.handle || creator.username),
    nickname: text(creator.nickname || creator.displayName || creator.fullName),
    follower_cnt: creator.follower_cnt ?? creator.followerCount ?? creator.followers ?? null,
    following_cnt: creator.following_cnt ?? creator.followingCount ?? creator.following ?? null,
    media_count: creator.media_count ?? creator.mediaCount ?? creator.postCount ?? null,
    category,
    垂直类目: text(creator.verticalCategory || category),
    主页外链: text(creator.externalLink || creator.website),
    主页认证: text(creator.isVerified),
    主页类目: text(creator.profileCategory),
    简介: text(creator['简介'] || creator.biography || creator.bio || creator.description),
    合作邮箱: publicEmail,
    // These fields remain in raw_json. They distinguish explicit public
    // profile values from future inferred or imported values.
    contact_email_provenance: publicEmail ? text(creator.emailProvenance || 'public_profile') : '',
    category_provenance: category ? text(creator.categoryProvenance || (creator.verificationStatus ? 'keyword_category' : 'public_profile')) : '',
    platform: 'instagram',
  };
}

function normalizeWorkerCreator(platformId, creator) {
  if (platformId === 'youtube') return normalizeYouTubeCreator(creator);
  if (platformId === 'x') return normalizeXCreator(creator);
  if (platformId === 'instagram') return normalizeInstagramCreator(creator);
  return { ...creator, creator_oecuid: text(creator.creator_oecuid || creator.creatorId || creator.nativeId) };
}

function creatorFromWorkerItem(event) {
  if (!event || event.type !== 'item' || !event.payload || typeof event.payload !== 'object') {
    throw new CreatorPersistenceError(PERSISTENCE_ERROR_CODES.INVALID_ITEM, 'Worker item event is required');
  }
  const creator = event.payload.creator || event.payload;
  if (!creator || typeof creator !== 'object' || Array.isArray(creator)) {
    throw new CreatorPersistenceError(PERSISTENCE_ERROR_CODES.INVALID_ITEM, 'Worker item must contain a creator object');
  }
  const creatorId = creator.creator_oecuid ?? creator.creatorId ?? creator.nativeId;
  if (typeof creatorId !== 'string' || creatorId.trim() === '') {
    throw new CreatorPersistenceError(PERSISTENCE_ERROR_CODES.INVALID_ITEM, 'Worker creator native ID must be a non-empty string');
  }
  return { ...creator, creator_oecuid: creatorId };
}

class CreatorPersistence {
  constructor({ repository, platformId }) {
    if (!repository || typeof repository.upsertCreators !== 'function') throw new TypeError('repository.upsertCreators is required');
    if (typeof platformId !== 'string' || !platformId) throw new TypeError('platformId is required');
    this.repository = repository;
    this.platformId = platformId;
  }

  async persistItem(event, { region = 'GLOBAL', jobId = null, discoveryMetadata = null } = {}) {
    const normalized = normalizeWorkerCreator(this.platformId, creatorFromWorkerItem(event));
    // Store the declared discovery context alongside the creator, so a later
    // filter/export can distinguish a category-derived result from a manually
    // supplied target. It contains no account, cookie, or session material.
    const creator = discoveryMetadata && typeof discoveryMetadata === 'object'
      ? { ...normalized, ...discoveryMetadata }
      : normalized;
    try {
      const result = await this.repository.upsertCreators([creator], { region, jobId });
      return {
        type: 'checkpoint',
        taskId: event.taskId,
        platform: this.platformId,
        payload: {
          sourceSequence: event.seq,
          nativeId: creator.creator_oecuid,
          inserted: Number(result.inserted || 0),
          updated: Number(result.updated || 0),
        },
      };
    } catch (_) {
      throw new CreatorPersistenceError(PERSISTENCE_ERROR_CODES.PERSIST_FAILED, 'Unable to persist worker creator item');
    }
  }
}

module.exports = {
  CreatorPersistence, CreatorPersistenceError, PERSISTENCE_ERROR_CODES,
  creatorFromWorkerItem, normalizeWorkerCreator, normalizeYouTubeCreator, normalizeXCreator, normalizeInstagramCreator,
};
