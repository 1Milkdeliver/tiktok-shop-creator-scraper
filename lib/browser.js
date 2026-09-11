// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { toPuppeteerCookies } = require('./cookies');
const {bounded, pageState} = require('./session-startup');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const DEBUG_PORT = 9222;
// TikTok Shop region (US / UK / SG / MY / TH / VN / PH / ID / MX / BR / ...).
// Set before opening the landing page; used for the landing URL and API params.
let shopRegion = 'US';
function setShopRegion(r) { shopRegion = (r || 'US').toUpperCase().trim() || 'US'; }
function landingUrl() {
  return `https://affiliate.tiktokshopglobalselling.com/affiliate/creator?source_from=seller_affiliate_landing&shop_region=${shopRegion}&route_migration=1`;
}

function findChrome() {
  for (const p of CHROME_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch (e) { }
  }
  return null;
}

// Try to connect to an already-running Chrome with --remote-debugging-port
async function tryConnect(port = DEBUG_PORT) {
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${port}`,
      defaultViewport: null,
      protocolTimeout: 15000,
    });
    return browser;
  } catch (e) {
    return null;
  }
}

// Launch a NEW real-window Chrome with a fresh profile
// Partner collection may start minimized and surface the same real window only
// when the platform requires login or manual verification.
async function launchRealWindow(cookieFile, compact, options = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome，请先安装 Google Chrome');
  const background = options?.background === true;
  // use a temp profile dir so we don't disturb the user's default Chrome
  const profileDir = path.join(os.tmpdir(), 'tiktok-pack-profile-' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: false,
    userDataDir: profileDir,
    args: [
      '--no-first-run', '--no-default-browser-check',
      // compact = multi-account mode: smaller window + less GPU memory
      `--window-size=${compact ? '900,700' : '1400,900'}`,
      '--disable-blink-features=AutomationControlled',
      ...(background ? ['--start-minimized','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'] : []),
      ...(compact ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 30000,
  });
  const setWindowVisible = async (visible, targetPage) => {
    const page = targetPage || (await browser.pages())[0];
    if (!page) return;
    const client = await page.createCDPSession();
    try {
      const {windowId} = await client.send('Browser.getWindowForTarget');
      await client.send('Browser.setWindowBounds',{windowId,bounds:{windowState:visible?'normal':'minimized'}});
    } finally { await client.detach().catch(()=>{}); }
  };
  return { browser, profileDir, setWindowVisible };
}

// Launch headless Chrome (may not be supported in all environments)
async function launchHeadless(cookieFile) {
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome，请先安装 Google Chrome');
  const profileDir = path.join(os.tmpdir(), 'tiktok-pack-headless-' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: profileDir,
    args: [
      '--no-first-run', '--no-default-browser-check',
      '--window-size=1400,900',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 30000,
  });
  return { browser, profileDir };
}

// Open the landing page in a page, import cookies, wait for SPA
// Returns { page, sellerId } — sellerId (oec_seller_id) is required by the
// profile API; without it the API answers code=100000.
async function openLandingPage(browser, cookieFile, isStopped) {
  const page = await browser.newPage();
  try {
  const cookies = toPuppeteerCookies(require('./cookies').loadCookies(cookieFile));
  if (cookies.length) {
    await page.browserContext().setCookie(...cookies).catch(e => { throw new Error('Cookie 导入失败: ' + e.message); });
  }
  // Cap the initial navigation so a wedged page can't stall shutdown either.
  await bounded(() => page.goto(landingUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 }),
    {timeoutMs:65000, isStopped:isStopped || (() => false)});
  // wait for SPA / SDK to settle: poll until the page shows real content
  // instead of sleeping a fixed 90s. If the browser is closed (user clicked
  // 结束) or a stop was requested, bail out immediately.
  for (let i = 0; i < 20; i++) {
    if (isStopped && isStopped()) break;
    const state = await bounded(() => page.evaluate(pageState),
      {timeoutMs:8000, isStopped:isStopped || (() => false)});
    // An actual login/challenge is conclusive: don't wait 40 seconds and probe a shop ID.
    if (state.hasLogin || state.challenge) return {page, sellerId:''};
    if (state.bodyLen > 300) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // Detect the current shop's oec_seller_id so the profile API works.
  // TikTok exposes it in several places; probe them all.
  let sellerId = '';
  if (!isStopped || !isStopped()) {
    try {
      sellerId = await Promise.race([
        page.evaluate(() => {
          const findIn = (obj, key) => {
            if (!obj) return null;
            if (typeof obj[key] === 'string' || typeof obj[key] === 'number') return String(obj[key]);
            return null;
          };
          // 1) common global objects
          const globals = ['__INITIAL_STATE__', '__NEXT_DATA__', 'store', 'state', 'window.__STORE__'];
          for (const g of globals) {
            const o = (typeof window !== 'undefined') ? window[g] : null;
            if (o) {
              const raw = JSON.stringify(o);
              const m = raw.match(/"oec_seller_id"\s*:\s*"?(\d{10,})"?/);
              if (m) return m[1];
              const m2 = raw.match(/seller_id["']?\s*:\s*["']?(\d{10,})/);
              if (m2) return m2[1];
            }
          }
          // 2) page URL query / path
          const u = location.href;
          const qm = u.match(/[?&]seller_id=(\d{10,})/);
          if (qm) return qm[1];
          // 3) localStorage keys
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              const v = localStorage.getItem(k) || '';
              if (k.includes('seller') || k.includes('shop')) {
                const m = v.match(/oec_seller_id["']?\s*:\s*["']?(\d{10,})/);
                if (m) return m[1];
                const m2 = v.match(/seller_id["']?\s*:\s*["']?(\d{10,})/);
                if (m2) return m2[1];
              }
              if (v.length > 500) {
                const m = v.match(/"oec_seller_id"\s*:\s*"?(\d{10,})"?/);
                if (m) return m[1];
              }
            }
          } catch (e) { }
          return '';
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('sellerid-timeout')), 15000)),
      ]);
    } catch (e) { }
  }

  // Fallback: intercept real network requests on the page and read oec_seller_id
  // from the actual API URLs the SPA fires (most reliable signal).
  if (!sellerId && (!isStopped || !isStopped())) {
    try {
      sellerId = await new Promise((resolve) => {
        const listener = (req) => {
          const u = req.url() || '';
          const m = u.match(/[?&]oec_seller_id=(\d{10,})/);
          if (m) { page.off('request', listener); resolve(m[1]); }
        };
        page.on('request', listener);
        // give the SPA a moment to fire its initial API calls (interruptible)
        const timer = setInterval(() => {
          if (isStopped && isStopped()) { clearInterval(timer); page.off('request', listener); resolve(''); }
        }, 300);
        setTimeout(() => { clearInterval(timer); page.off('request', listener); resolve(''); }, 12000);
      });
    } catch (e) { }
  }
  return { page, sellerId };
  } catch (error) {
    await bounded(() => page.close(), {timeoutMs:2000}).catch(() => {});
    throw error;
  }
}

// In-page API caller using fetch() — verified to work with TikTok's
// find/profile APIs, whereas XMLHttpRequest returns code=100000 (risk-control
// fingerprinting). The page's own SDK still auto-signs the request headers.
//
// Robustness: a fetch can fail with "Cannot read properties of undefined
// (reading 'headers')" when the page navigates mid-evaluate (SPA redirect,
// risk-control page, another session's heavy load). We retry up to 3× with a
// short backoff so a transient navigation never kills a whole page's batch.
function makeXhrFinder(page, apiPath, sellerId) {
  return async (body) => {
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Race the whole evaluate against a hard timeout. page.evaluate can
        // hang forever when the renderer becomes unresponsive (crashed page,
        // stuck navigation, CDP stall) — the in-page fetch abort never fires
        // because the script never runs. A hung evaluate would otherwise stop
        // the detail loop dead at N creators with no error.
        const text = await Promise.race([
          page.evaluate(async (apiPath, body, region, sellerId) => {
            const qs = `user_language=zh-CN&aid=6556&app_name=i18n_ecom_alliance&device_id=0&device_platform=web&shop_region=${region}${sellerId ? '&oec_seller_id=' + sellerId : ''}`;
            // wait for the page to be interactive before fetch — a fetch issued
            // while the SPA is still navigating returns a broken response object
            if (document.readyState === 'loading') {
              await new Promise(r => setTimeout(r, 1500));
            }
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 30000); // 30s cap per call
            try {
              const res = await fetch(apiPath + '?' + qs, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*' },
                body: JSON.stringify(body),
                credentials: 'include',
                signal: ctrl.signal,
              });
              return await res.text();
            } finally {
              clearTimeout(timer);
            }
          }, apiPath, body, shopRegion, sellerId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate-timeout')), 60000)),
        ]);
        return text;
      } catch (e) {
        lastErr = String(e && e.message || e);
        // If the browser/page is gone (user clicked 结束, or a crash), retrying
        // is pointless and would stall the shutdown for seconds per attempt.
        // Bail out immediately so the run finishes promptly.
        if ((page.isClosed && page.isClosed()) || /Target closed|Execution context was destroyed/i.test(lastErr)) {
          return JSON.stringify({ err: 'fetch-error: ' + lastErr });
        }
        // A hung page (evaluate-timeout) usually means the renderer is wedged:
        // try reloading the page once so the next attempt runs on a fresh context.
        if (/evaluate-timeout/i.test(lastErr)) {
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { }); } catch (e2) { }
          try { await new Promise(r => setTimeout(r, 2000)); } catch (e2) { }
        }
        // transient navigation / context destroyed → small backoff then retry
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000 + attempt * 3000));
      }
    }
    return JSON.stringify({ err: 'fetch-error: ' + lastErr });
  };
}

module.exports = { tryConnect, launchRealWindow, launchHeadless, openLandingPage, makeXhrFinder, findChrome, landingUrl, setShopRegion, DEBUG_PORT };
