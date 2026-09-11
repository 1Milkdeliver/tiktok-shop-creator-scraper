'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function browserFixture() {
  const filename = path.resolve(__dirname, '../lib/browser.js');
  const localRequire = createRequire(filename);
  const calls = [];
  const cookies = [];
  const context = { setCookie: async (...items) => { cookies.push(...items); } };
  const page = {
    browserContext: () => context,
    goto: async url => calls.push({ goto: url }),
    evaluate: async () => 500,
  };
  const browser = { newPage: async () => page };
  const puppeteer = {
    launch: async options => { calls.push(options); return browser; },
    connect: async options => { calls.push(options); return browser; },
  };
  const sandbox = {
    module: { exports: {} },
    require: name => name === 'puppeteer-core' ? puppeteer : name === 'fs'
      ? { ...fs, existsSync: () => true } : localRequire(name),
    console: { log() {} },
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {},
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return { api: sandbox.module.exports, calls, cookies, browser, context, page };
}

test('Puppeteer ESM package and scraper constructors load in the supported Node runtime', () => {
  const puppeteer = require('puppeteer-core');
  assert.equal(typeof puppeteer.launch, 'function');
  assert.equal(typeof puppeteer.connect, 'function');
  assert.equal(typeof require('../lib/multirunner').MultiRunner, 'function');
  assert.equal(typeof require('../lib/runner').Runner, 'function');
});

test('Chrome modes keep current connect port and use supported boolean headless options', async () => {
  const { api, calls } = browserFixture();
  await api.launchHeadless(null);
  await api.launchRealWindow(null, true);
  await api.tryConnect(12345);
  assert.equal(calls[0].headless, true);
  assert.equal(calls[1].headless, false);
  assert.match(calls[0].userDataDir, /tiktok-pack-headless/);
  assert.match(calls[1].userDataDir, /tiktok-pack-profile/);
  assert.equal(calls[2].browserURL, 'http://127.0.0.1:12345');
});

test('landing page imports synthetic cookies through BrowserContext and preserves region', async () => {
  const { api, cookies, calls, browser } = browserFixture();
  api.setShopRegion('my');
  await api.openLandingPage(browser, [{ name: 'fixture', value: 'synthetic-only', domain: '.example.test' }], () => true);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].domain, '.example.test');
  assert.match(calls[0].goto, /shop_region=MY/);
});

test('cookie import errors stop before navigation instead of silently continuing', async () => {
  const { api, context, browser, calls } = browserFixture();
  context.setCookie = async () => { throw new Error('fixture import failure'); };
  await assert.rejects(api.openLandingPage(browser,
    [{ name: 'fixture', value: 'synthetic-only', domain: '.example.test' }]), /Cookie 导入失败/);
  assert.equal(calls.length, 0);
});

test('actual login or challenge ends landing preflight without extra waiting or shop-ID probes',async()=>{
  for (const state of [{bodyLen:92,hasLogin:true},{bodyLen:500,challenge:true}]) {
    const fixture=browserFixture();let evaluations=0;
    fixture.page.evaluate=async()=>{evaluations++;return state;};
    const result=await fixture.api.openLandingPage(fixture.browser,[]);
    assert.equal(evaluations,1);assert.equal(result.sellerId,'');
  }
});
