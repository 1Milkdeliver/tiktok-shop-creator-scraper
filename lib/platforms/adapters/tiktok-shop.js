'use strict';

const { validateNativeId, validateStructuredEvent } = require('../contract');

// Registration-only bridge for the current TikTok Shop workflow. Nothing in
// main.js or MultiRunner instantiates it yet, so existing behavior is unchanged.
// A future orchestrator can inject a MultiRunner-compatible runnerFactory.
class TikTokShopAdapter {
  constructor({ runnerFactory } = {}) {
    this.platformId = 'tiktok_shop';
    this.taskCapabilities = ['creator_discovery', 'creator_profile', 'creator_export'];
    this.runnerFactory = runnerFactory;
    this.runner = null;
  }

  validateNativeId(nativeId) {
    return validateNativeId(nativeId);
  }

  validateEvent(event) {
    return validateStructuredEvent(event, this.platformId);
  }

  async start(config) {
    if (!this.runnerFactory) {
      throw new Error('TikTok Shop adapter is registered but has not been wired to a runner');
    }
    if (this.runner && this.runner.running) throw new Error('TikTok Shop adapter is already running');
    this.runner = this.runnerFactory();
    if (!this.runner || typeof this.runner.start !== 'function') {
      throw new TypeError('TikTok Shop runnerFactory must return an object with start(config)');
    }
    return this.runner.start(config);
  }

  pause() {
    if (!this.runner || typeof this.runner.pause !== 'function') return false;
    this.runner.pause();
    return true;
  }

  resume() {
    if (!this.runner || typeof this.runner.resume !== 'function') return false;
    this.runner.resume();
    return true;
  }

  async resumeWithRefresh() {
    if (!this.runner) return false;
    if (typeof this.runner.resumeWithRefresh === 'function') {
      await this.runner.resumeWithRefresh();
      return true;
    }
    return this.resume();
  }

  stop() {
    if (!this.runner || typeof this.runner.stop !== 'function') return false;
    this.runner.stop();
    return true;
  }
}

function createTikTokShopAdapter(options) {
  return new TikTokShopAdapter(options);
}

module.exports = { TikTokShopAdapter, createTikTokShopAdapter };
