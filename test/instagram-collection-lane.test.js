'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InstagramCollectionLane } = require('../lib/tasks/instagram-collection-lane');

test('one Instagram collection lane rejects overlap and permits the next task after release', () => {
  const lane = new InstagramCollectionLane();
  assert.equal(lane.isActive(), false);
  assert.equal(lane.tryAcquire(), true);
  assert.equal(lane.isActive(), true);
  assert.equal(lane.tryAcquire(), false);
  lane.release();
  assert.equal(lane.isActive(), false);
  assert.equal(lane.tryAcquire(), true);
});

test('independent lanes can run concurrently without sharing Instagram state', () => {
  const instagram = new InstagramCollectionLane();
  const anotherPlatform = new InstagramCollectionLane();
  assert.equal(instagram.tryAcquire(), true);
  assert.equal(anotherPlatform.tryAcquire(), true);
});
