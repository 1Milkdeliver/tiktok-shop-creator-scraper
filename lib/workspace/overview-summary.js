'use strict';

const { PLATFORM_IDS } = require('../platforms/catalog');

const WORKSPACE_PLATFORM_IDS = Object.freeze([...PLATFORM_IDS]);

function toNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

function connectionSummary(platformId, { cookieCount = 0, socialAccounts = [] } = {}) {
  if (platformId === 'youtube') return { state: 'ready', accounts: 0, requiresAuthorization: false };
  if (platformId === 'tiktok_shop') {
    const accounts = Math.max(0, toNumber(cookieCount));
    return { state: accounts ? 'connected' : 'needs_authorization', accounts, requiresAuthorization: true };
  }
  const accounts = (Array.isArray(socialAccounts) ? socialAccounts : []).filter(account => account?.platform === platformId).length;
  return { state: accounts ? 'connected' : 'needs_authorization', accounts, requiresAuthorization: true };
}

function buildWorkspaceOverview({ platformStats = {}, cookieCount = 0, socialAccounts = [], activeTask = null, recentJobs = [] } = {}) {
  const platforms = WORKSPACE_PLATFORM_IDS.map(id => {
    const stats = platformStats[id] || {};
    return {
      id,
      connection: connectionSummary(id, { cookieCount, socialAccounts }),
      creators: toNumber(stats.creators),
      withEmail: toNumber(stats.with_email),
      bytes: toNumber(stats.bytes),
      lastRefreshedAt: stats.last_refreshed_at || null,
      jobs: stats.jobs || { running: 0, completed: 0, failed: 0 },
    };
  });
  const totals = platforms.reduce((result, platform) => ({
    creators: result.creators + platform.creators,
    withEmail: result.withEmail + platform.withEmail,
    bytes: result.bytes + platform.bytes,
    connectedPlatforms: result.connectedPlatforms + (platform.connection.state === 'connected' || platform.connection.state === 'ready' ? 1 : 0),
  }), { creators: 0, withEmail: 0, bytes: 0, connectedPlatforms: 0 });
  return {
    platforms,
    totals: { ...totals, platformCount: platforms.length },
    activeTask: activeTask || null,
    recentJobs: Array.isArray(recentJobs) ? recentJobs.slice(0, 5) : [],
  };
}

module.exports = { WORKSPACE_PLATFORM_IDS, connectionSummary, buildWorkspaceOverview };
