'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyActivity } = require('../lib/activity');

const NOW = Date.parse('2026-08-23T00:00:00.000Z');

test('activity classification explains active, inactive, and unknown creators', () => {
  assert.equal(classifyActivity({ last_publish_time:'2026-08-10T00:00:00Z' }, NOW).activity_status, 'active');
  assert.equal(classifyActivity({ last_publish_time:'2026-04-01T00:00:00Z', med_gmv_revenue:9999 }, NOW).activity_reason, 'no_post_90d');
  assert.equal(classifyActivity({ med_gmv_revenue:200 }, NOW).activity_reason, 'recent_performance');
  assert.equal(classifyActivity({ med_gmv_revenue:0, units_sold:0, video_avg_view_cnt:0, video_engagement:0 }, NOW).activity_status, 'inactive');
  assert.equal(classifyActivity({}, NOW).activity_status, 'unknown');
});
