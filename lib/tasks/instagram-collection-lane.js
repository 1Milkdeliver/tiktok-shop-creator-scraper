'use strict';

// Instagram browser work shares a session and a network identity.  This lane
// intentionally permits exactly one active Instagram collection, while other
// platform collectors remain independent.  It does not know or retain any
// credential, handle, URL, or profile data.
class InstagramCollectionLane {
  constructor() {
    this.active = false;
  }

  tryAcquire() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release() {
    this.active = false;
  }

  isActive() {
    return this.active;
  }
}

module.exports = { InstagramCollectionLane };
