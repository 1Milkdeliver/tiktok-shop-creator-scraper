'use strict';

const LAST_PUBLISH_KEYS = [
  'last_publish_time', 'last_post_time', 'last_video_publish_time',
  'latest_video_publish_time', 'latest_post_time', 'last_video_create_time',
];

function numberOf(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') value = value.value ?? value.maximum ?? value.format;
  const text = String(value).replace(/,/g, '');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let number = Number(match[0]);
  if (/K/i.test(text)) number *= 1e3;
  else if (/M/i.test(text)) number *= 1e6;
  else if (/B/i.test(text)) number *= 1e9;
  return Number.isFinite(number) ? number : null;
}

function normalizeTime(value) {
  if (!value) return '';
  if (typeof value === 'object') value = value.value ?? value.timestamp ?? value.create_time;
  if (/^\d{10,13}$/.test(String(value))) {
    const number = Number(value); return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function extractLastPublishTime(row) {
  for (const key of LAST_PUBLISH_KEYS) {
    const normalized = normalizeTime(row?.[key]);
    if (normalized) return normalized;
  }
  return '';
}

function classifyActivity(row, now = Date.now()) {
  const lastPublishTime = extractLastPublishTime(row);
  const daysSincePost = lastPublishTime ? Math.max(0, Math.floor((now - new Date(lastPublishTime).getTime()) / 86400000)) : null;
  const gmv = numberOf(row.med_gmv_revenue ?? row.total_gmv);
  const sales = numberOf(row.units_sold);
  const viewValues = [numberOf(row.video_avg_view_cnt), numberOf(row.video_play_cnt_med)];
  const engagementValues = [numberOf(row.video_engagement), numberOf(row.ec_video_engagement)];
  const views = Math.max(...viewValues.map(value => value || 0));
  const engagement = Math.max(...engagementValues.map(value => value || 0));
  const hasPerformance = [gmv, sales, ...viewValues, ...engagementValues].some(value => value !== null);
  const strongPerformance = (gmv || 0) > 0 || (sales || 0) > 0 || views >= 1000 || engagement >= 100;

  if (daysSincePost !== null && daysSincePost > 90) return { activity_status:'inactive', activity_reason:'no_post_90d', last_publish_time: lastPublishTime };
  if (daysSincePost !== null && daysSincePost > 45 && !strongPerformance) return { activity_status:'inactive', activity_reason:'stale_and_low_performance', last_publish_time: lastPublishTime };
  if (daysSincePost !== null && daysSincePost <= 45) return { activity_status:'active', activity_reason:'recent_post', last_publish_time: lastPublishTime };
  if (strongPerformance) return { activity_status:'active', activity_reason:'recent_performance', last_publish_time: lastPublishTime };
  if (hasPerformance && [gmv, sales, views, engagement].every(value => (value || 0) === 0)) return { activity_status:'inactive', activity_reason:'no_recent_performance', last_publish_time: lastPublishTime };
  return { activity_status:'unknown', activity_reason:'insufficient_data', last_publish_time: lastPublishTime };
}

function applyActivity(row) { return { ...row, ...classifyActivity(row) }; }

module.exports = { LAST_PUBLISH_KEYS, extractLastPublishTime, classifyActivity, applyActivity };
