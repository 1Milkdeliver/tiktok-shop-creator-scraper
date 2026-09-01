// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const fs = require('fs');
const { extractLastPublishTime } = require('./activity');

const FIND_API = '/api/v1/oec/affiliate/creator/marketplace/find';
const PROFILE_API = '/api/v1/oec/affiliate/creator/marketplace/profile';
const PAGE_SIZE = 12;
// random delay range (ms) to mimic human-like browsing rhythm
const DELAY_MIN = 6000;
const DELAY_MAX = 15000;
// faster pacing when NOT scraping details (list-only mode)
const FAST_DELAY_MIN = 3000;
const FAST_DELAY_MAX = 7000;
const MAX_FAILS = 5;
const STALL_PAGES = 40;

function humanDelay(fast) {
  // fast = list-only scraping (no details): shorter pauses, fewer long breaks
  if (fast) {
    let d = FAST_DELAY_MIN + Math.random() * (FAST_DELAY_MAX - FAST_DELAY_MIN);
    if (Math.random() < 0.08) d += 5000 + Math.random() * 8000; // 8% longer pause
    return d;
  }
  // normal (with details): random between DELAY_MIN..DELAY_MAX, sometimes a longer "pause"
  let d = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
  if (Math.random() < 0.15) d += 8000 + Math.random() * 15000; // 15% chance of a longer pause
  return d;
}

// sleep that returns early once isStopped() turns true, so a stop click
// (结束) never waits out the full humanized delay / risk-control pause.
function interruptibleSleep(ms, isStopped) {
  return new Promise(resolve => {
    const step = 250;
    let waited = 0;
    const tick = () => {
      if (isStopped && isStopped()) return resolve();
      waited += step;
      if (waited >= ms) return resolve();
      setTimeout(tick, step);
    };
    setTimeout(tick, step);
  });
}

// extract slim fields from a find-list creator
function slimCreator(c) {
  const g = (k, d) => { const f = c[k]; if (f === null || f === undefined) return d; if (typeof f === 'object' && 'is_authorized' in f) return f.value === undefined ? d : f.value; return f; };
  const avatar = g('avatar');
  const avatarUrl = avatar && typeof avatar === 'object' ? (avatar.url_list || avatar.thumb_url_list || [])[0] || '' : '';
  const row = {
    creator_oecuid: g('creator_oecuid'), handle: g('handle'), nickname: g('nickname'), avatar: avatarUrl,
    selection_region: g('selection_region'), follower_cnt: g('follower_cnt'),
    category: g('category'), video_avg_view_cnt: g('video_avg_view_cnt'), video_play_cnt_med: g('video_play_cnt_med'),
    video_engagement: g('video_engagement'), ec_video_engagement: g('ec_video_engagement'),
    video_gmv: g('video_gmv'), live_gmv: g('live_gmv'), med_gmv_revenue: g('med_gmv_revenue'),
    med_gmv_revenue_range: g('med_gmv_revenue_range'), units_sold: g('units_sold'), units_sold_range: g('units_sold_range'),
    ec_video_gpm: g('ec_video_gpm'), ec_live_gpm: g('ec_live_gpm'), ec_live_avg_uv: g('ec_live_avg_uv'),
    top_follower_ages: g('top_follower_ages'), top_follower_gender: g('top_follower_gender'),
    pps_score: g('pps_score'), is_fast_growing: g('is_fast_growing'), has_collaborated: g('has_collaborated'),
    creator_permission_tag: g('creator_permission_tag'), is_live_auction: g('is_live_auction'),
  };
  row.last_publish_time = extractLastPublishTime(c);
  return row;
}

// flatten detail profile object
function flattenProfile(profile) {
  const out = {};
  for (const k of Object.keys(profile || {})) {
    const v = profile[k];
    if (v && typeof v === 'object' && 'is_authorized' in v) {
      const val = v.value;
      if (val === undefined || val === null) continue;
      out[k] = typeof val === 'object' ? JSON.stringify(val) : String(val);
    } else if (v !== undefined && v !== null) {
      out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
  return out;
}

// Extract useful detail fields (bio, email, MCN, sales, collab) from a flattened profile
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function extractDetailFields(profile) {
  const out = {};
  const bio = profile.bio || '';
  if (bio) out['简介'] = String(bio).slice(0, 1000);
  const emails = String(bio).match(EMAIL_RE) || [];
  if (emails.length) out['合作邮箱'] = [...new Set(emails)].join(', ');
  const mcn = profile.creator_bind_mcn_name;
  if (mcn) out['MCN机构'] = String(mcn).slice(0, 200);
  const cat = profile.category;
  if (cat) {
    try { const arr = JSON.parse(cat); if (Array.isArray(arr)) out['类目'] = arr.map(x => x.name || '').filter(Boolean).join(' | '); }
    catch (e) { out['类目'] = cat; }
  }
  // vertical (2nd-level) creator category, e.g. vertical_creator_pro_tag_option_beauty_self_care
  const vcat = profile.vertical_pro_category;
  if (vcat) {
    try {
      const parsed = typeof vcat === 'string' ? JSON.parse(vcat) : vcat;
      const arr = parsed && Array.isArray(parsed.value) ? parsed.value : (Array.isArray(parsed) ? parsed : []);
      const keys = arr.map(x => (x && x.starling_key) || '').filter(Boolean);
      if (keys.length) {
        // store the short form (strip the common prefix) so filtering is clean
        out['垂直类目'] = keys.map(k => k.replace(/^vertical_creator_pro_tag_option_/, '')).join(' | ');
      }
    } catch (e) { }
  }
  const lastPublishTime = extractLastPublishTime(profile);
  if (lastPublishTime) out.last_publish_time = lastPublishTime;
  return out;
}

// scrapes all keywords' pools; returns { creators, rateLimited }
async function scrapeList(page, keywords, { onProgress, resumeState, isStopped, isPaused, maxPages, onNewCreators, sellerId, fast, sharedSeen }) {
  const xhrFind = require('./browser').makeXhrFinder(page, FIND_API, sellerId);
  const creators = [];
  const seen = new Set();

  let state = { dims: {} };
  if (resumeState && fs.existsSync(resumeState)) {
    try { state = JSON.parse(fs.readFileSync(resumeState, 'utf8')); } catch (e) { }
  }
  if (state.creators && Array.isArray(state.creators)) {
    for (const c of state.creators) {
      const id = c && c.creator_oecuid;
      const key = id == null ? '' : String(id);
      if (key && !seen.has(key)) { seen.add(key); creators.push(c); }
      // resumed creators count as "already seen" for cross-session dedupe too
      if (sharedSeen && key) sharedSeen.add(key);
    }
  }

  const saveState = () => {
    if (resumeState) {
      try { fs.writeFileSync(resumeState, JSON.stringify({ dims: state.dims, creators })); } catch (e) { }
    }
  };

  let fails = 0;
  for (const kw of keywords) {
    if (isStopped && isStopped()) break;
    let st = state.dims[kw];
    if (!st) { st = { page: 0, searchKey: '', cursor: 0, hasMore: true, stall: 0, totalNew: 0 }; state.dims[kw] = st; }
    if (!st.hasMore) { onProgress && onProgress(`[${kw}] done (${st.totalNew} new)`); continue; }
    onProgress && onProgress(`=== ${kw} from page ${st.page} ===`);
    while (st.hasMore) {
      if (isStopped && isStopped()) { saveState(); onProgress && onProgress('已停止'); break; }
      if (isPaused && isPaused()) {
        saveState(); // persist progress immediately on pause so nothing is lost
        onProgress && onProgress('⏸ 已暂停，等待继续...');
        while (isPaused() && !(isStopped && isStopped())) {
          await new Promise(r => setTimeout(r, 500));
        }
        onProgress && onProgress('▶ 继续');
        if (isStopped && isStopped()) break;
      }
      if (maxPages && st.page >= maxPages) { onProgress && onProgress(`[${kw}] 测试模式仅抓 ${maxPages} 页`); st.hasMore = false; break; }
      const body = { query: kw, pagination: { page: st.page, size: PAGE_SIZE, search_key: st.searchKey || '', next_item_cursor: st.cursor || 0 }, algorithm: 1, filter_params: {} };
      const raw = await xhrFind(body);
      let j;
      try { j = JSON.parse(raw); } catch (e) { fails++; onProgress && onProgress(`[${kw}] p${st.page}: parse fail`); if (fails >= MAX_FAILS) break; await interruptibleSleep(15000, isStopped); continue; }
      if (j.err || j.code !== 0) {
        fails++;
        onProgress && onProgress(`[${kw}] p${st.page}: code=${j.code || j.err} (fails=${fails})`);
        if (fails >= MAX_FAILS) break;
        await interruptibleSleep(15000, isStopped);
        continue;
      }
      fails = 0;
      const list = j.creator_profile_list || [];
      let added = 0;
      const newOnes = []; // newly added creators this page (for immediate detail queue)
      for (const c of list) {
        const id = c.creator_oecuid && c.creator_oecuid.value;
        const key = id == null ? '' : String(id);
        // cross-session dedupe: another session (or an earlier resume) may have
        // already collected this creator — skip it to avoid duplicate export
        if (key && !seen.has(key) && !(sharedSeen && sharedSeen.has(key))) {
          const slim = slimCreator(c);
          seen.add(key); creators.push(slim); added++;
          newOnes.push(slim);
          if (sharedSeen) sharedSeen.add(key);
        }
      }
      if (newOnes.length && onNewCreators) {
        try { await onNewCreators(newOnes); } catch (e) { }
      }
      const np = j.next_pagination || {};
      st.hasMore = !!np.has_more;
      st.page = np.next_page != null ? np.next_page : st.page + 1;
      st.searchKey = np.search_key || st.searchKey;
      st.cursor = np.next_item_cursor != null ? np.next_item_cursor : st.cursor;
      st.stall = added < 5 ? (st.stall || 0) + 1 : 0;
      st.totalNew = (st.totalNew || 0) + added;
      if (creators.length % 30 < 12) saveState();
      onProgress && onProgress(`[${kw}] p${st.page - 1}: +${added} (total ${creators.length})`);
      if (!st.hasMore) { onProgress && onProgress(`[${kw}] DONE`); break; }
      if ((st.stall || 0) >= STALL_PAGES) { onProgress && onProgress(`[${kw}] stalled`); st.hasMore = false; break; }
      await interruptibleSleep(humanDelay(fast), isStopped);
    }
    saveState();
    if (fails >= MAX_FAILS) {
      onProgress && onProgress('连续失败（可能被限流/风控），停止本阶段等待自动恢复');
      saveState();
      return { creators, rateLimited: true };
    }
  }
  saveState();
  return { creators, rateLimited: false };
}

// Parse user-supplied creator list lines into { type: 'id'|'handle', value }
// Accepted formats:
//   - pure numeric: TikTok creator oecuid
//   - handle: "beauty.pro", "@beauty.pro"
//   - tiktok link: "https://www.tiktok.com/@beauty.pro?lang=en" (extracts @handle)
function parseCreatorInput(lines) {
  const out = [];
  const seen = new Set();
  for (const raw of (lines || [])) {
    const s = String(raw).trim();
    if (!s) continue;
    let value = '';
    let type = null;
    // link → handle
    const link = s.match(/tiktok\.com\/@([A-Za-z0-9_.\-]+)/i);
    if (link) { value = link[1]; type = 'handle'; }
    // pure digits → id
    else if (/^\d{6,}$/.test(s)) { value = s; type = 'id'; }
    // @handle or bare handle
    else { value = s.replace(/^@/, ''); type = 'handle'; }
    if (!value) continue;
    const key = type + ':' + value;
    if (!seen.has(key)) { seen.add(key); out.push({ type, value }); }
  }
  return out;
}

// Scrape creators from a user-supplied list (ids + handles).
// IDs → used directly; handles → resolved via the find API (query match),
// then slim creators are returned for the detail phase.
async function scrapeByInput(page, inputs, { onProgress, isStopped, isPaused, onNewCreators, fast, sharedSeen }) {
  const xhrFind = require('./browser').makeXhrFinder(page, FIND_API);
  const creators = [];
  const seen = new Set();
  let fails = 0;

  // 1) collect plain ids
  const ids = inputs.filter(i => i.type === 'id').map(i => i.value);
  for (const id of ids) {
    if (isStopped && isStopped()) break;
    const key = String(id);
    if (seen.has(key)) continue;
    if (sharedSeen && sharedSeen.has(key)) continue; // another session already has it
    seen.add(key);
    if (sharedSeen) sharedSeen.add(key);
    creators.push({ creator_oecuid: id, handle: '', nickname: '', source: 'id' });
  }
  onProgress && onProgress(`名单：${ids.length} 个数值 ID 已入列`);

  // 2) resolve handles via find API (query the exact handle)
  const handles = inputs.filter(i => i.type === 'handle').map(i => i.value);
  let idx = 0;
  for (const h of handles) {
    idx++;
    if (isStopped && isStopped()) break;
    onProgress && onProgress(`[handle ${idx}/${handles.length}] ${h} ...`);
    const body = { query: h, pagination: { page: 0, size: 12, search_key: '', next_item_cursor: 0 }, algorithm: 1, filter_params: {} };
    let resolved = false;
    try {
      const raw = await xhrFind(body);
      const j = JSON.parse(raw);
      if (!j.err && j.code === 0 && Array.isArray(j.creator_profile_list)) {
        for (const c of j.creator_profile_list) {
          const ch = c.handle && c.handle.value;
          if (ch && ch.toLowerCase() === h.toLowerCase()) {
            const id = c.creator_oecuid && c.creator_oecuid.value;
            if (id && !seen.has(id)) {
              seen.add(id);
              creators.push(slimCreator(c));
              resolved = true;
            }
            break;
          }
        }
      }
    } catch (e) { }
    if (!resolved) {
      onProgress && onProgress(`[handle] ${h} 未匹配到达人（可能不存在或名称不同）`);
      fails++;
    }
    await interruptibleSleep(humanDelay(fast), isStopped);
  }
  onProgress && onProgress(`名单解析完成：共 ${creators.length} 位达人（${ids.length} ID + ${handles.length - fails} handle）`);
  if (onNewCreators && creators.length) {
    try { await onNewCreators(creators); } catch (e) { }
  }
  return { creators, rateLimited: fails >= MAX_FAILS };
}

// scrape full profiles; returns { details, rateLimited }
async function scrapeDetails(page, creators, { onProgress, resumeFile, isStopped, isPaused }) {
  const xhrProfile = require('./browser').makeXhrFinder(page, PROFILE_API);
  const doneMap = new Set();
  if (resumeFile && fs.existsSync(resumeFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));
      if (Array.isArray(prev)) for (const d of prev) doneMap.add(String(d.creator_oecuid));
    } catch (e) { }
  }
  const results = [];
  if (resumeFile && fs.existsSync(resumeFile)) {
    try { const prev = JSON.parse(fs.readFileSync(resumeFile, 'utf8')); if (Array.isArray(prev)) results.push(...prev); } catch (e) { }
  }

  let fails = 0;
  const saveResults = () => {
    if (resumeFile) {
      try { fs.writeFileSync(resumeFile, JSON.stringify(results)); } catch (e) { }
    }
  };
  for (const c of creators) {
    if (isStopped && isStopped()) { saveResults(); onProgress && onProgress('已停止'); break; }
    if (isPaused && isPaused()) {
      saveResults(); // persist details immediately on pause
      onProgress && onProgress('⏸ 已暂停，等待继续...');
      while (isPaused() && !(isStopped && isStopped())) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (isStopped && isStopped()) { saveResults(); break; }
    }
    const cid = c.creator_oecuid == null ? '' : String(c.creator_oecuid);
    if (!cid || doneMap.has(cid)) continue;
    const raw = await xhrProfile({ creator_oec_id: cid, profile_types: [1, 2, 3, 5] });
    let j;
    try { j = JSON.parse(raw); } catch (e) { fails++; if (fails >= MAX_FAILS) break; await interruptibleSleep(12000, isStopped); continue; }
    if (j.err || j.code !== 0) {
      fails++;
      onProgress && onProgress(`${cid}: code=${j.code || j.err} (fails=${fails})`);
      if (fails >= MAX_FAILS) break;
      await interruptibleSleep(12000, isStopped);
      continue;
    }
    fails = 0;
    const profile = j.creator_profile || {};
    const flat = flattenProfile(profile);
    results.push({ creator_oecuid: cid, handle: c.handle || '', ...extractDetailFields(flat) });
    if (results.length % 20 === 0 && resumeFile) {
      try { fs.writeFileSync(resumeFile, JSON.stringify(results)); } catch (e) { }
    }
    onProgress && onProgress(`detail ${results.length}/${creators.length}`);
    await interruptibleSleep(humanDelay(), isStopped);
  }
  if (resumeFile) {
    try { fs.writeFileSync(resumeFile, JSON.stringify(results)); } catch (e) { }
  }
  return { details: results, rateLimited: fails >= MAX_FAILS };
}

module.exports = { scrapeList, scrapeDetails, scrapeByInput, parseCreatorInput, slimCreator, extractDetailFields, flattenProfile, FIND_API, PROFILE_API };
