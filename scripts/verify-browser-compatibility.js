'use strict';
// Real Chrome/CDP compatibility, but loopback fixtures only: no account or platform requests.
const assert = require('node:assert/strict');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const { findChrome, tryConnect, makeXhrFinder, setShopRegion } = require('../lib/browser');

(async () => {
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/fixture/profile')) {
      requests++;
      let body = '';
      for await (const chunk of req) body += chunk;
      const query = new URL(req.url, 'http://127.0.0.1').searchParams;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 0, body: JSON.parse(body), region: query.get('shop_region'),
        fixtureCookie: (req.headers.cookie || '').includes('compat_fixture=synthetic-only') }));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta charset="utf-8"><title>Local compatibility fixture</title><p>本地测试</p>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = findChrome();
    assert(executablePath, 'Chrome is required for this explicit compatibility check');
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check'] });
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: 'compat_fixture', value: 'synthetic-only', domain: '127.0.0.1', path: '/' });
    const page = await context.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname === '127.0.0.1' || url.protocol === 'data:') request.continue();
      else request.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.title(), 'Local compatibility fixture');
    setShopRegion('MY');
    const fetchProfile = makeXhrFinder(page, '/fixture/profile', 'synthetic-id');
    for (let i = 0; i < 3; i++) {
      const result = JSON.parse(await fetchProfile({ fixture: i }));
      assert.equal(result.code, 0);
      assert.equal(result.fixtureCookie, true);
      assert.equal(result.region, 'MY');
      assert.equal(result.body.fixture, i);
    }
    const connection = await tryConnect(Number(new URL(browser.wsEndpoint()).port));
    assert(connection, 'App CDP connection helper failed');
    assert((await connection.pages()).length > 0);
    await connection.disconnect();
    assert.equal(await page.title(), 'Local compatibility fixture');
    await context.close();
    return { chrome: await browser.version(), loopbackRequests: requests, cookieContext: true,
      connectDisconnect: true, platformRequests: 0, productionSessionsRead: false };
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().then(result => {
  // The legacy transport leaves losing timeout promises alive; all resources above are closed.
  process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
}).catch(error => {
  process.stderr.write(error.message + '\n', () => process.exit(1));
});
