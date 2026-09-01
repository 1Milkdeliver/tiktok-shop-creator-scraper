// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const fs = require('fs');

// Load cookies from:
//  - Chrome extension JSON export (array of {domain,name,value,expirationDate,...})
//  - raw string "name=value; name2=value2"
function loadCookies(source) {
  if (source && typeof source === 'object' && Array.isArray(source)) return source;
  if (typeof source !== 'string') throw new Error('Cookie 必须是 JSON 文件路径或字符串');
  const raw = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const j = JSON.parse(trimmed);
    if (!Array.isArray(j)) throw new Error('Cookie JSON 格式错误：应为数组');
    return j;
  }
  // raw cookie string
  return trimmed.split(';').map(pair => {
    const [name, ...rest] = pair.trim().split('=');
    return { name: name.trim(), value: rest.join('=').trim() };
  });
}

// A cookie applies to `host` if:
//  - hostOnly: domain === host
//  - else: host === domain || host.endsWith('.' + domain)
function cookieApplies(c, host) {
  let d = c.domain;
  if (!d) return false;
  if (d.startsWith('.')) d = d.slice(1);
  if (c.hostOnly) return d === host;
  return host === d || host.endsWith('.' + d);
}

function cookieHeader(cookies, host) {
  return cookies
    .filter(c => c.name && cookieApplies(c, host))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

// Convert cookie array to puppeteer page.setCookie compatible objects
function toPuppeteerCookies(cookies) {
  return cookies
    .filter(c => c.name && c.value)
    .map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || undefined,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      expires: c.expirationDate ? c.expirationDate : undefined,
    }))
    .filter(c => c.domain);
}

module.exports = { loadCookies, cookieHeader, cookieApplies, toPuppeteerCookies };
