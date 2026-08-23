// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const { tryConnect, launchRealWindow, launchHeadless, openLandingPage, setShopRegion } = require('./browser');
const { scrapeList, scrapeDetails, scrapeByInput, parseCreatorInput, extractDetailFields, flattenProfile, PROFILE_API } = require('./scraper');
const { exportCsv, exportXlsx, mergeRows, ensureDir } = require('./exporter');
const path = require('path');
const fs = require('fs');
const { applyActivity } = require('./activity');

// 字段 key → 中英文表头名（与 index.html 的 FIELDS 保持同步）
const FIELD_LABELS = {
  handle: { zh: '达人主页', en: 'Creator Page' },
  nickname: { zh: '昵称', en: 'Nickname' },
  creator_oecuid: { zh: '达人ID', en: 'Creator ID' },
  avatar: { zh: '头像', en: 'Avatar' },
  selection_region: { zh: '地区', en: 'Region' },
  follower_cnt: { zh: '粉丝数', en: 'Followers' },
  category: { zh: '类目', en: 'Category' },
  med_gmv_revenue: { zh: '总GMV', en: 'Total GMV' },
  med_gmv_revenue_range: { zh: 'GMV区间', en: 'GMV Range' },
  video_gmv: { zh: '视频GMV', en: 'Video GMV' },
  live_gmv: { zh: '直播GMV', en: 'Live GMV' },
  units_sold: { zh: '销量', en: 'Units Sold' },
  units_sold_range: { zh: '销量区间', en: 'Units Sold Range' },
  video_avg_view_cnt: { zh: '平均视频观看', en: 'Avg Video Views' },
  video_play_cnt_med: { zh: '视频中位观看', en: 'Median Video Views' },
  video_engagement: { zh: '视频互动量', en: 'Video Engagement' },
  ec_video_engagement: { zh: '电商视频互动', en: 'E-comm Video Engagement' },
  ec_video_gpm: { zh: '电商GPM', en: 'E-comm GPM' },
  ec_live_gpm: { zh: '直播GPM', en: 'Live GPM' },
  ec_live_avg_uv: { zh: '电商平均UV', en: 'E-comm Avg UV' },
  top_follower_ages: { zh: '粉丝年龄段', en: 'Audience Ages' },
  top_follower_gender: { zh: '粉丝性别分布', en: 'Audience Gender' },
  pps_score: { zh: 'PPS评分', en: 'PPS Score' },
  is_fast_growing: { zh: '快速增长', en: 'Fast Growing' },
  has_collaborated: { zh: '已合作', en: 'Collaborated' },
  creator_permission_tag: { zh: '达人类目权限', en: 'Category Permission' },
  is_live_auction: { zh: '直播拍卖', en: 'Live Auction' },
  '简介': { zh: '简介', en: 'Bio' },
  '合作邮箱': { zh: '合作邮箱', en: 'Contact Email' },
  'MCN机构': { zh: 'MCN机构', en: 'MCN Agency' },
  last_publish_time: { zh: '最后发布时间', en: 'Last published' },
  activity_status: { zh: '活跃状态', en: 'Activity status' },
  activity_reason: { zh: '判断原因', en: 'Activity reason' },
};
function fieldLabel(key, lang) {
  const m = FIELD_LABELS[key];
  return m ? (m[lang] || key) : key;
}

class MultiRunner {
  constructor() {
    this.running = false;
    this.stopped = false;
    this.paused = false;
    this.status = 'idle'; // idle | running | paused | done | error
    this.currentInfo = { keyword: '', page: 0, total: 0 };
    this.logs = [];
    this.result = null;
    this.sessions = [];
    this.rateLimit = null; // { at: timestamp, session: n, reason: string }
    this.detailStopped = false; // set by a 2nd stop click to abort the detail phase
  }

  // record a risk-control (captcha / code=10000) event for UI display
  markRateLimit(sessionIndex, reason) {
    this.rateLimit = { at: Date.now(), session: sessionIndex + 1, reason: reason || '验证码/风控' };
    this.log(`⚠️ 会话 #${sessionIndex + 1} 触发风控（${this.rateLimit.reason}），建议稍后重试`);
  }

  // pause: finish current page then hold; resume: continue
  pause() { if (this.running && !this.paused) { this.paused = true; this.status = 'paused'; this.log('⏸ 已暂停（完成当前请求后挂起）'); } }
  resume() { if (this.paused) { this.clearAutoResume(); this.paused = false; this.status = 'running'; this.log('▶ 继续抓取'); } }

  // ── auto-resume after risk control ──
  // When a session hits a captcha / quota limit, we pause and schedule an
  // automatic resume after the cool-down (default 30 min). A background timer
  // checks the clock and calls resume() by itself, so the user doesn't have to
  // sit and watch. Manual resume or stop cancels the pending schedule.
  scheduleAutoResume(minutes) {
    this.autoResumeAt = Date.now() + (minutes || 30) * 60000;
    this.log(`⏰ 风控冷却 ${minutes || 30} 分钟后自动继续（${new Date(this.autoResumeAt).toLocaleTimeString()}）——期间可手动完成滑块验证`);
    if (!this._autoResumeTimer) {
      this._autoResumeTimer = setInterval(() => {
        if (this.stopped) { this.clearAutoResume(); return; }
        if (this.paused && this.autoResumeAt && Date.now() >= this.autoResumeAt) {
          this.clearAutoResume();
          this.log('⏰ 冷却结束，自动继续抓取');
          this.resume();
        }
      }, 5000);
    }
  }
  clearAutoResume() {
    if (this._autoResumeTimer) { clearInterval(this._autoResumeTimer); this._autoResumeTimer = null; }
    this.autoResumeAt = null;
  }

  // returns a promise that resolves immediately if not paused, or waits until resumed
  async pauseGate() {
    while (this.paused && !this.stopped) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 1000) this.logs.shift();
    console.log(msg);
    // external file-log hook (set by main process)
    if (this.onFileLog) { try { this.onFileLog(line); } catch (e) { } }
  }

  async start(config) {
    if (this.running) throw new Error('已在运行中');
    this.running = true;
    this.stopped = false;
    this.detailStopped = false;
    this.paused = false;
    this.status = 'running';
    this.logs = [];
    this.result = null;
    this.clearAutoResume(); // drop any stale auto-resume schedule from a prior run

    const { cookieFiles, mode, keywords, format, outPath, detail, fields, testMode, shopRegion, dedupe, creatorInput } = config;
    // region used for the landing URL + find API params
    try { setShopRegion(shopRegion || 'US'); } catch (e) { }
    // dedupe: skip creators already scraped (stored in .scraped-ids.json next to output)
    // outPath may be a dir (timestamped name) or a file (overwritePath) — use its dir
    const seenFile = path.join(/\.(csv|xlsx)$/i.test(outPath) ? path.dirname(outPath) : outPath, '.scraped-ids.json');
    let scrapedIds = new Set();
    try {
      if (fs.existsSync(seenFile)) {
        const arr = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
        if (Array.isArray(arr)) for (const id of arr) scrapedIds.add(String(id));
      }
    } catch (e) { }
    // merge IDs from an existing export file (used by "继续抓取" so already-saved
    // creators are not duplicated)
    if (config.existingIds && Array.isArray(config.existingIds)) {
      for (const id of config.existingIds) scrapedIds.add(String(id));
    }
    const sessions = cookieFiles.map((f, i) => ({
      index: i,
      cookieFile: f,
      browser: null,
      page: null,
      creators: [],
      details: [],
      rateLimited: false,
      done: false,
    }));
    this.sessions = sessions;
    // Backup-cookie pool: if a session hits risk-control / quota exhaustion, it
    // can rotate to the NEXT unused cookie file instead of retrying the same
    // one forever. Used cookies are tracked so each backup is tried once.
    this.cookiePool = cookieFiles.slice();
    this.usedCookies = new Set();

    // ── keyword distribution algorithm ──
    //   keywords >= sessions : round-robin shard — each session scrapes a
    //                          disjoint slice, so different keywords run in
    //                          parallel with zero overlap
    //   keywords <  sessions : SAME keyword, but only session #1 runs the list;
    //                          the others become DETAIL-WORKER sessions that pull
    //                          creators from a shared queue and only fetch
    //                          profiles — no duplicated page requests at all
    let perSessionKeywords;
    let detailWorkers = []; // indexes of sessions that only fetch details
    const sharedQueue = []; // creators produced by the list session for detail workers
    if (keywords.length >= sessions.length) {
      perSessionKeywords = sessions.map((_, i) => keywords.filter((_, k) => k % sessions.length === i));
      this.log(`关键词 ${keywords.length} 个 ≥ 会话 ${sessions.length} 个 → 轮转分片并行（每会话 ${Math.ceil(keywords.length / sessions.length)} 个）`);
    } else {
      perSessionKeywords = sessions.map(() => keywords);
      // only meaningful when detail is ON: split list vs detail work
      if (detail && sessions.length > 1) {
        detailWorkers = sessions.slice(1).map(s => s.index);
        this.log(`关键词 ${keywords.length} 个 < 会话 ${sessions.length} 个 → 分工模式：会话 #1 跑列表，会话 #${detailWorkers.map(i => i + 1).join(', #')} 只抓详情`);
      } else {
        this.log(`关键词 ${keywords.length} 个 < 会话 ${sessions.length} 个 → 同关键词并发（快速模式无详情可分摊）`);
      }
    }
    this.detailWorkers = detailWorkers;
    this.sharedQueue = sharedQueue;

    // cross-session dedupe set: every creator a session collects is recorded
    // here, so no other session re-collects the same creator. When dedupe is
    // ON it is pre-seeded with already-scraped IDs (skip them right away);
    // when OFF (refresh) it starts empty so everything is re-collected once.
    const sharedSeen = new Set();
    if (dedupe) {
      for (const id of scrapedIds) sharedSeen.add(id);
    }
    // separate set for DETAILS: sharedSeen covers list collection only, so a
    // second set prevents two sessions from both fetching the same profile
    const sharedDetailSeen = new Set();

    try {
      this.log(`══════ 多账号并发抓取 ══════`);
      this.log(`Cookie 数: ${sessions.length} | 关键词: ${keywords.length} | 模式: ${mode} | 详情: ${detail ? '是' : '否'} | 站点: ${(shopRegion || 'US').toUpperCase()} | 查重: ${dedupe ? '开' : '关'}${creatorInput && creatorInput.length ? ' | 名单导入: ' + creatorInput.length + ' 条' : ''}${testMode ? ' | 测试模式' : ''}`);

      // Start sessions concurrently with a short stagger (8-15s). The stagger
      // only spaces out browser launches to avoid tripping risk control — it
      // does NOT wait for a session to finish, so all accounts scrape in
      // parallel. Multi-session runs force ISOLATED windows (each cookie gets
      // its own Chrome profile) instead of tryConnect, so accounts never share
      // a browser (fingerprint/risk-control isolation).
      const isolated = sessions.length > 1;
      this.sessionsIsolated = isolated;
      const startSession = async (i) => {
        const s = sessions[i];
        try {
          s.browser = await this.openSession(mode, s.cookieFile, i, isolated);
          const lp = await openLandingPage(s.browser, s.cookieFile);
          s.page = lp.page;
          s.sellerId = lp.sellerId || '';
          if (s.sellerId) this.log(`会话 #${i + 1}: 店铺 ID ${s.sellerId}`);
          const st = await s.page.evaluate(() => ({
            bodyLen: document.body ? document.body.innerText.length : 0,
            hasLogin: !!document.querySelector('input[type=password]'),
          }));
          this.log(`会话 #${i + 1}: 内容 ${st.bodyLen} | 登录框: ${st.hasLogin}`);
          if (st.hasLogin || st.bodyLen < 200) {
            s.cookieInvalid = true; // remember for the summary below
            this.log(`⚠️ 会话 #${i + 1} Cookie 无效或已过期（跳转到登录页/空白页），已跳过`);
            this.log(`   → 请在该账号的浏览器重新登录 TikTok Shop 联盟后台，重新导出 Cookie 后替换`);
            s.done = true;
            return;
          }
          // run this session's scrape in the background (parallel)
          this.runSession(s, perSessionKeywords[i], detail, outPath, testMode, dedupe, creatorInput, seenFile, scrapedIds, sharedSeen, sharedDetailSeen, config.resume !== false, mode, isolated).catch(e => this.log(`会话 #${i + 1} 错误: ${e.message}`));
        } catch (e) {
          this.log(`会话 #${i + 1} 启动失败: ${e.message}`);
          s.done = true;
        }
      };
      // fire all session startups without awaiting each other.
      // Stagger grows with session count: more accounts on one IP = higher
      // risk-control odds, so spread launches further apart (10s base + 5s/extra session).
      const stagger = 10000 + (sessions.length - 1) * 5000 + Math.random() * 7000;
      const startupPromises = sessions.map((_, i) => (async () => {
        await new Promise(r => setTimeout(r, i * stagger));
        if (this.stopped) return;
        await startSession(i);
      })());
      await Promise.allSettled(startupPromises);

      // Wait for all sessions to finish. A stop request does NOT skip this wait:
      // each session detects isStopped, breaks out of its loops, keeps the data
      // already scraped (s.creators), then marks done — only then do we export.
      // Safety cap: measure from the STOP request, not from run start, so a long
      // run never false-triggers "timeout" the moment the user clicks stop.
      let stopWaitStart = null;
      while (true) {
        const active = sessions.filter(s => !s.done);
        if (active.length === 0) break;
        if (this.stopped) {
          if (!stopWaitStart) stopWaitStart = Date.now();
          if (Date.now() - stopWaitStart > 120000) {
            this.log('⚠️ 等待会话结束超时，直接导出已抓取数据');
            break;
          }
        }
        await this.sleep(5000);
      }

      // summary of sessions skipped due to invalid/expired cookies
      const invalid = sessions.filter(s => s.cookieInvalid);
      if (invalid.length) {
        this.log(`\n⚠️ ${invalid.length} 个账号因 Cookie 无效/过期被跳过（会话 #${invalid.map(s => s.index + 1).join(', #')}）`);
        this.log('   请在对应账号的浏览器重新登录后导出最新 Cookie，再开始抓取。');
      }

      // merge + export
      const allCreators = [];
      const seen = new Set();
      for (const s of sessions) {
        for (const c of s.creators) {
          const id = c && c.creator_oecuid;
          const key = id == null ? '' : String(id);
          if (key && !seen.has(key)) { seen.add(key); allCreators.push(c); }
        }
      }
      const allDetails = [];
      for (const s of sessions) allDetails.push(...s.details);
      const rows = mergeRows(allCreators, allDetails).map(applyActivity);
      // Persist the canonical raw rows before display labels/field filtering are
      // applied. The database owns dedupe; CSV/Excel remains a compatibility
      // output during the transition to on-demand exports.
      let database = { saved: 0 };
      if (!testMode && this.onDataReady && rows.length) {
        try {
          database = await this.onDataReady(rows, config) || database;
          this.log(`💾 本地达人库已更新 ${database.saved || 0} 条（自动去重）`);
        } catch (e) {
          // A database problem must not destroy the legacy export path. Surface
          // it prominently, then continue exporting the rows already scraped.
          this.log(`⚠️ 本地达人库写入失败，继续使用文件导出: ${e.message}`);
          database = { saved: 0, error: e.message };
        }
      }
      // optional field filter: EVERY selected field becomes a column (empty if no data)
      const lang = (config.headerLang === 'en') ? 'en' : 'zh';
      const pick = (Array.isArray(fields) && fields.length) ? fields : Object.keys(rows[0] || {});
      const filtered = rows.map(r => { const o = {}; for (const f of pick) o[fieldLabel(f, lang)] = r[f] ?? ''; return o; });
      const headers = Object.keys(filtered[0] || {});
      if (testMode) {
        // test mode: no file output, just report counts
        this.log(`\n── 测试完成：抓取 ${filtered.length} 行（未导出文件）`);
        this.result = { ok: true, rows: filtered.length, outPath: '', creators: allCreators.length, details: allDetails.length, sessions: sessions.length, testMode: true };
      } else {
        // 0 rows scraped → do NOT create an empty export file (no file, no history entry)
        if (filtered.length === 0) {
          this.log('\n⚠️ 本次没有抓到任何达人（可能 Cookie 失效/风控/关键词无结果），未生成导出文件');
          this.result = { ok: true, rows: 0, outPath: '', creators: 0, details: 0, sessions: sessions.length, empty: true, database };
          return;
        }
        // if outPath is a directory (no extension), generate a timestamped filename inside it;
        // if overwritePath is set (continue/refresh from history), write directly to that file
        let finalPath = outPath;
        if (config.overwritePath && /\.(csv|xlsx)$/i.test(config.overwritePath)) {
          finalPath = config.overwritePath;
        } else if (!/\.(csv|xlsx)$/i.test(outPath)) {
          const ts = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
          finalPath = path.join(outPath, `达人数据-${stamp}.${format}`);
        }
        ensureDir(path.dirname(finalPath));
        this.log(`\n── 导出 ${filtered.length} 行 × ${headers.length} 字段 → ${finalPath}`);
        if (format === 'xlsx') await exportXlsx(finalPath, filtered, headers);
        else await exportCsv(finalPath, filtered, headers);
        this.log('✅ 导出完成！');
        this.result = { ok: true, rows: filtered.length, outPath: finalPath, creators: allCreators.length, details: allDetails.length, sessions: sessions.length, database };
      }
    } catch (e) {
      this.log('❌ 错误: ' + e.message);
      this.status = 'error';
      this.result = { ok: false, error: e.message };
    } finally {
      this.running = false;
      if (this.status !== 'error') this.status = this.stopped ? 'done' : 'done';
      // close every browser (window + process) so no Chrome residue stays on screen.
      // Progress is preserved on disk via .resume-*.json, so a later run can continue.
      for (const s of sessions) {
        try {
          if (s.browser) {
            await Promise.race([
              s.browser.close(),
              new Promise(r => setTimeout(r, 5000)),
            ]).catch(() => { });
          }
        } catch (e) { }
      }
      this.log('已完成，浏览器窗口已关闭。已抓取进度已保存，可随时重新开始并自动续接。');
      // notify main immediately so history is recorded reliably (not via polling)
      if (this.onDone && this.result) {
        try { this.onDone(this.result); } catch (e) { }
      }
    }
  }

  async runSession(s, keywords, detail, outPath, testMode, dedupe, creatorInput, seenFile, scrapedIds, sharedSeen, sharedDetailSeen, resumeEnabled, mode, sessionsIsolated) {
    // Resume files live next to the OUTPUT (same dir as the export / .scraped-ids).
    // outPath may be a directory (timestamped name generated later) or a full file
    // (overwritePath for continue/refresh) — resolve the directory consistently.
    const outDir = /\.(csv|xlsx)$/i.test(outPath) ? path.dirname(outPath) : outPath;
    // Resume files are keyed by SESSION INDEX + KEYWORD SET HASH so that
    // "continue" after a cookie-count change still maps each session to the
    // same keywords it scraped before (shard assignment is deterministic).
    const kwHash = keywords.slice().sort().join('|');
    const resumeList = path.join(outDir, `.resume-list-${s.index}-${hashStr(kwHash)}.json`);
    const resumeDetail = path.join(outDir, `.resume-detail-${s.index}-${hashStr(kwHash)}.json`);
    ensureDir(outDir); // make sure resume dir exists before writing
    // refresh mode (resumeEnabled=false): a previous run's resume state must NOT
    // be reused — re-scrape everything and clear the stale resume files
    if (!resumeEnabled) {
      try { if (fs.existsSync(resumeList)) fs.unlinkSync(resumeList); } catch (e) { }
      try { if (fs.existsSync(resumeDetail)) fs.unlinkSync(resumeDetail); } catch (e) { }
    }
    try {
      this.log(`会话 #${s.index + 1}: 开始抓取...`);

      // details are fetched AFTER the list phase (batched), which is more
      // stable against TikTok's risk control than concurrent workers.
      let detailDoneIds = new Set();   // creators already fetched (dedupe)
      let detailResults = [];
      // load previously-fetched details from resume so we don't re-fetch them
      if (resumeDetail && fs.existsSync(resumeDetail)) {
        try {
          const prev = JSON.parse(fs.readFileSync(resumeDetail, 'utf8'));
          if (Array.isArray(prev)) {
            detailResults = prev;
            for (const d of prev) {
              detailDoneIds.add(String(d.creator_oecuid));
              if (sharedDetailSeen) sharedDetailSeen.add(String(d.creator_oecuid));
            }
          }
        } catch (e) { }
      }
      let xhrProfile = require('./browser').makeXhrFinder(s.page, PROFILE_API, s.sellerId);
      let detailCount = detailResults.length;

      const fetchOneDetail = async (c) => {
        const cid = c.creator_oecuid == null ? '' : String(c.creator_oecuid);
        if (!cid || detailDoneIds.has(cid)) return false;
        // cross-session detail dedupe: another session may already be fetching
        // (or have fetched) this creator — skip so details aren't doubled
        if (sharedDetailSeen && sharedDetailSeen.has(cid)) return false;

        // One combined call [1,2,3,5] via fetch() returns the full profile
        // (verified: 47 fields incl. bio). code=100000 is intermittent
        // throttling → retry up to 3× with a pause.
        let mergedProfile = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const raw = await xhrProfile({ creator_oec_id: cid, profile_types: [1, 2, 3, 5] });
          let j;
          try { j = JSON.parse(raw); } catch (e) { break; }
          if (j.err || j.code !== 0) {
            const code = j.code || j.err;
            if (code === 16901008) return false;      // creator removed/banned → skip
            if (code === 16901007) {                    // rate limited → slow down
              await this.sleep(15000);
              continue;
            }
            if (code === 100000) {                      // intermittent throttle → retry
              await this.sleep(6000 + Math.random() * 6000);
              continue;
            }
            return false;                               // other errors → skip creator
          }
          mergedProfile = j.creator_profile || {};
          break;
        }
        if (!mergedProfile) return false;

        const flat = flattenProfile(mergedProfile);
        detailResults.push({ creator_oecuid: cid, handle: c.handle || '', ...extractDetailFields(flat) });
        detailDoneIds.add(cid);
        // mark as fetched globally so no other session re-fetches it
        if (sharedDetailSeen) sharedDetailSeen.add(cid);
        detailCount++;
        // record scraped id for future dedupe (if enabled)
        if (dedupe && scrapedIds) {
          scrapedIds.add(cid);
          try { fs.writeFileSync(seenFile, JSON.stringify([...scrapedIds])); } catch (e) { }
        }
        if (detailCount % 20 === 0 && resumeDetail) {
          try { fs.writeFileSync(resumeDetail, JSON.stringify(detailResults)); } catch (e) { }
        }
        this.log(`  会话#${s.index + 1} 详情 ${detailCount} 条`);
        return true;
      };

      // Shared progress handler
      const progressCb = (m) => {
        this.log(`  会话#${s.index + 1} ${m}`);
        const kwMatch = m.match(/===\s*([^ ]+)\s*from page (\d+)/);
        if (kwMatch) { this.currentInfo.keyword = kwMatch[1]; this.currentInfo.page = parseInt(kwMatch[2]) || 0; }
        const totalMatch = m.match(/total (\d+)/);
        if (totalMatch) this.currentInfo.total = parseInt(totalMatch[1]) || 0;
        if (/code=10000|风控|验证码|captcha|rate.?limit/i.test(m)) {
          this.markRateLimit(s.index, m);
          if (this.running && !this.paused && !this.stopped) {
            this.paused = true;
            this.status = 'paused';
            this.log(`⚠️ 会话 #${s.index + 1} 遇到验证码/风控，已自动暂停。`);
            // auto-resume after the cool-down instead of waiting for a human
            this.scheduleAutoResume(30);
          }
        }
      };

      // ── collect phase with session rotation: a session lasts ~600-800 API
      // requests before TikTok returns code=10000 (quota exhausted). When that
      // happens (scrapeList → rateLimited), close the browser and reopen with a
      // FRESH cookie from the backup pool (or the same one if no backup left),
      // then continue from the resume state. Up to 3 rotations.
      let res = null;
      let rotatedCookie = false;
      for (let rot = 0; rot < 3 && !this.stopped; rot++) {
        if (rot > 0) {
          // pick a backup cookie (never reuse one already tried in this run)
          const backup = this.takeBackupCookie(s);
          const cookieLabel = backup && backup !== s.cookieFile ? '（切换到备用账号）' : '（无备用账号，继续用当前）';
          this.log(`⚠️ 会话 #${s.index + 1} 配额可能耗尽/风控，等待后换新会话继续（第 ${rot + 1} 次轮换）${cookieLabel}...`);
          // close old browser
          try {
            if (s.browser) await Promise.race([s.browser.close(), new Promise(r => setTimeout(r, 5000))]).catch(() => { });
          } catch (e) { }
          await this.sleep(30000); // 30s (not 60s) — fresh cookie needs less cool-down
          // reopen a fresh session with the (possibly new) cookie
          try {
            if (backup) { s.cookieFile = backup; rotatedCookie = true; }
            s.browser = await this.openSession(mode, s.cookieFile, s.index, sessionsIsolated);
            const lp2 = await openLandingPage(s.browser, s.cookieFile);
            s.page = lp2.page;
            s.sellerId = lp2.sellerId || '';
            xhrProfile = require('./browser').makeXhrFinder(s.page, PROFILE_API, s.sellerId);
          } catch (e) {
            this.log(`会话 #${s.index + 1} 换会话失败: ${e.message}`);
            break;
          }
        }

        if (creatorInput && creatorInput.length) {
          // 名单模式：跳过关键词，直接按 ID/handle 解析达人
          let inputs = parseCreatorInput(creatorInput);
          if (inputs.length > 500) {
            this.log(`⚠️ 名单超过单次上限 500 条（共 ${inputs.length} 条），本次仅处理前 500 条，请分批抓取`);
            inputs = inputs.slice(0, 500);
          }
          res = await scrapeByInput(s.page, inputs, {
            isStopped: () => this.stopped,
            isPaused: () => this.paused,
            fast: !detail, // list-only mode → faster pacing
            sharedSeen,
            onNewCreators: async (newOnes) => {
              if (!detail) return;
              // 即时串行补详情（模拟人类节奏）
              for (const c of newOnes) {
                if (this.detailStopped) break;
                while (this.paused && !this.detailStopped && this.running) await this.sleep(700);
                try { await fetchOneDetail(c); } catch (e) { }
                await this.sleep(4000 + Math.random() * 5000); // tested-stable pacing (4-9s)
              }
            },
            onProgress: progressCb,
          });
        } else if (this.isDetailWorker(s.index)) {
          // ── DETAIL-WORKER session (same keyword, many accounts) ──
          // Does NOT paginate the list at all. It waits for the list session to
          // push creators into the shared queue and fetches their profiles.
          this.log(`会话 #${s.index + 1}: 详情分摊模式，等待列表会话产出达人...`);
          res = { creators: [], rateLimited: false };
          await this.consumeSharedQueue(s, detail, fetchOneDetail, resumeList);
        } else {
          res = await scrapeList(s.page, keywords, {
            resumeState: resumeList,
            isStopped: () => this.stopped,
            isPaused: () => this.paused,
            maxPages: testMode ? 1 : Infinity,
            sellerId: s.sellerId,
            fast: !detail, // list-only mode → faster pacing
            sharedSeen,
            onNewCreators: async (newOnes) => {
              if (!detail) return;
              if (this.detailWorkers.length) {
                // split mode: the LIST session pushes creators to the shared
                // queue; detail workers pull from it (and the list session
                // helps too when workers are busy)
                this.pushToSharedQueue(newOnes);
                return;
              }
              // 即时串行补详情：每页新达人人逐个抓，模拟人类操作，再翻下一页
              let skipped = 0;
              for (const c of newOnes) {
                if (this.detailStopped) break;
                while (this.paused && !this.detailStopped && this.running) await this.sleep(700);
                const cid = c.creator_oecuid == null ? '' : String(c.creator_oecuid);
                // dedupe: skip creators already scraped
                if (dedupe && cid && scrapedIds.has(cid)) { skipped++; continue; }
                try { await fetchOneDetail(c); } catch (e) { }
                await this.sleep(4000 + Math.random() * 5000); // tested-stable pacing (4-9s)
              }
              if (skipped) this.log(`  会话#${s.index + 1} 查重跳过 ${skipped} 位已抓达人`);
            },
            onProgress: progressCb,
          });
        }
        // quota exhausted → rotate; otherwise done with the collect phase
        if (res && res.rateLimited) continue;
        break;
      }
      s.creators = (res && res.creators) || [];
      this.log(`会话 #${s.index + 1}: 列表 ${s.creators.length} 条`);
      // list session finished → tell detail workers the queue is closing so
      // they exit once they've drained what's left
      if (!this.isDetailWorker(s.index)) {
        this.queueClosed = true;
      }

      // ── tail: fetch any remaining details ONLY during normal flow (resume
      // recovery / failed retries). If the user clicked stop, skip it — instant
      // mode already scraped details for every new creator, so nothing is lost.
      // In SPLIT mode (detail workers active) the list session never fetches
      // details itself — workers drain the queue — so skip the tail here.
      if (detail && s.creators.length && !this.stopped && !this.detailWorkers.length) {
        const remaining = s.creators.filter(c => !detailDoneIds.has(c == null ? '' : String(c.creator_oecuid)));
        if (remaining.length) {
          this.log(`会话 #${s.index + 1}: 补充 ${remaining.length} 位达人详情（断点恢复/重试）...`);
          for (const c of remaining) {
            if (this.detailStopped || this.stopped) break;
            while (this.paused && !this.detailStopped && this.running) await this.sleep(700);
            const cid = c.creator_oecuid == null ? '' : String(c.creator_oecuid);
            if (dedupe && cid && scrapedIds.has(cid)) continue;
            try { await fetchOneDetail(c); } catch (e) { }
            await this.sleep(4000 + Math.random() * 5000); // tested-stable pacing (4-9s)
          }
        }
      }
      s.details = detailResults;
      if (resumeDetail) {
        try { fs.writeFileSync(resumeDetail, JSON.stringify(detailResults)); } catch (e) { }
      }
      this.log(`会话 #${s.index + 1}: 详情 ${s.details.length} 条`);
    } catch (e) {
      this.log(`会话 #${s.index + 1} 抓取错误: ${e.message}`);
    } finally {
      s.done = true;
    }
  }

  async openSession(mode, cookieFile, index, isolated) {
    if (mode === 'headless') {
      const l = await launchHeadless(cookieFile);
      return l.browser;
    } else if (mode === 'real' || isolated) {
      // isolated (multi-account): ALWAYS launch a dedicated real window with its
      // own Chrome profile — never attach to a shared tryConnect browser, so each
      // account has separate window/cookies/fingerprint. compact = smaller window
      // + GPU off to keep memory sane when several accounts run at once.
      const l = await launchRealWindow(cookieFile, isolated);
      return l.browser;
    }
    const b = await tryConnect();
    if (b) return b;
    const l = await launchRealWindow(cookieFile, false);
    return l.browser;
  }

  // Return a backup cookie file that hasn't been used by any session in this
  // run yet (excluding the session's own). Returns null when none is left.
  takeBackupCookie(s) {
    if (!this.cookiePool || !this.cookiePool.length) return null;
    // mark the session's current cookie as used so we don't hand it back
    if (s.cookieFile) this.usedCookies.add(s.cookieFile);
    const fresh = this.cookiePool.find(f => !this.usedCookies.has(f) && f !== s.cookieFile);
    if (!fresh) return null;
    this.usedCookies.add(fresh);
    return fresh;
  }

  isDetailWorker(index) {
    return this.detailWorkers && this.detailWorkers.includes(index);
  }

  // List session pushes newly-found creators so detail workers can pull them
  pushToSharedQueue(newOnes) {
    if (!this.sharedQueue) this.sharedQueue = [];
    for (const c of newOnes || []) this.sharedQueue.push(c);
  }

  // Detail-worker session: wait for creators in the shared queue (produced by
  // the list session) and fetch their profiles. Exits when the queue is
  // drained AND the list session signals it's done (queueClosed).
  async consumeSharedQueue(s, detail, fetchOneDetail, resumeList) {
    if (!detail) return;
    let idleRounds = 0;
    const idleLimit = 12; // ~12 × 5s = 60s of no new work → assume list done
    while (!this.stopped && !this.detailStopped) {
      while (this.paused && !this.stopped && this.running) await this.sleep(700);
      let c = null;
      if (this.sharedQueue && this.sharedQueue.length) c = this.sharedQueue.shift();
      if (c) {
        idleRounds = 0;
        const cid = c.creator_oecuid == null ? '' : String(c.creator_oecuid);
        try { await fetchOneDetail(c); } catch (e) { }
        await this.sleep(3000 + Math.random() * 4000); // slightly faster than list pacing
      } else {
        idleRounds++;
        if (this.queueClosed || idleRounds >= idleLimit) break;
        await this.sleep(5000);
      }
    }
    this.log(`会话 #${s.index + 1}: 详情分摊结束，共抓取详情`);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  stop() {
    if (this.running) {
      // One click = stop everything (finish current request, then export).
      // Instant detail mode already scraped details for collected creators,
      // so there is no "detail fill" phase to wait for.
      this.stopped = true;
      this.detailStopped = true;
      this.clearAutoResume(); // no auto-resume after an explicit stop
      if (this.paused) {
        this.paused = false;
        this.status = 'running';
      }
      this.log('收到结束请求，完成当前请求后立即保存并导出已抓取数据...');
    }
  }
}

// stable short hash for resume filenames (keyword-set identity)
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

module.exports = { MultiRunner };
