// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { toPuppeteerCookies } = require('./cookies');

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
// Window is kept visible so the user can manually solve captcha/slider challenges.
async function launchRealWindow(cookieFile, compact) {
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome，请先安装 Google Chrome');
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
      ...(compact ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 30000,
  });
  return { browser, profileDir };
}

// Launch headless Chrome (may not be supported in all environments)
async function launchHeadless(cookieFile) {
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome，请先安装 Google Chrome');
  const profileDir = path.join(os.tmpdir(), 'tiktok-pack-headless-' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
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
async function openLandingPage(browser, cookieFile) {
  const page = await browser.newPage();
  const cookies = toPuppeteerCookies(require('./cookies').loadCookies(cookieFile));
  if (cookies.length) {
    await page.setCookie(...cookies).catch(e => { throw new Error('Cookie 导入失败: ' + e.message); });
  }
  await page.goto(landingUrl(), { waitUntil: 'domcontentloaded', timeout: 120000 });
  // wait for SPA / SDK to settle
  await new Promise(r => setTimeout(r, 90000));

  // Detect the current shop's oec_seller_id so the profile API works.
  // TikTok exposes it in several places; probe them all.
  let sellerId = '';
  try {
    sellerId = await page.evaluate(() => {
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
    });
  } catch (e) { }

  // Fallback: intercept real network requests on the page and read oec_seller_id
  // from the actual API URLs the SPA fires (most reliable signal).
  if (!sellerId) {
    try {
      sellerId = await new Promise((resolve) => {
        const listener = (req) => {
          const u = req.url() || '';
          const m = u.match(/[?&]oec_seller_id=(\d{10,})/);
          if (m) { page.off('request', listener); resolve(m[1]); }
        };
        page.on('request', listener);
        // give the SPA a moment to fire its initial API calls
        setTimeout(() => { page.off('request', listener); resolve(''); }, 15000);
      });
    } catch (e) { }
  }
  if (sellerId) console.log('[browser] detected oec_seller_id=' + sellerId);
  return { page, sellerId };
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
        // A hung page (evaluate-timeout) usually means the renderer is wedged:
        // try reloading the page once so the next attempt runs on a fresh context.
        if (/evaluate-timeout|Execution context was destroyed|Target closed/i.test(lastErr)) {
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { }); } catch (e2) { }
          try { await new Promise(r => setTimeout(r, 5000)); } catch (e2) { }
        }
        // transient navigation / context destroyed → small backoff then retry
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000 + attempt * 3000));
      }
    }
    return JSON.stringify({ err: 'fetch-error: ' + lastErr });
  };
}

module.exports = { tryConnect, launchRealWindow, launchHeadless, openLandingPage, makeXhrFinder, findChrome, landingUrl, setShopRegion, DEBUG_PORT };
