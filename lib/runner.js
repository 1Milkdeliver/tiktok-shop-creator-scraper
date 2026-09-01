// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const { tryConnect, launchRealWindow, launchHeadless, openLandingPage } = require('./browser');
const { scrapeList, scrapeDetails } = require('./scraper');
const { exportCsv, exportXlsx, mergeRows, ensureDir } = require('./exporter');
const path = require('path');

class Runner {
  constructor() {
    this.running = false;
    this.stopped = false;
    this.logs = [];
    this.result = null;
  }

  log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 800) this.logs.shift();
    console.log(msg);
  }

  async start(config) {
    if (this.running) throw new Error('已在运行中');
    this.running = true;
    this.stopped = false;
    this.logs = [];
    this.result = null;

    const { cookieFile, mode, keywords, format, outPath, detail } = config;
    const resumeList = path.join(path.dirname(outPath), '.resume-list.json');
    const resumeDetail = path.join(path.dirname(outPath), '.resume-detail.json');

    let browser = null;
    let page = null;
    let sessionNum = 0;

    const openSession = async () => {
      sessionNum++;
      if (browser) { try { browser.disconnect(); } catch (e) { } }
      if (mode === 'headless') {
        const l = await launchHeadless(cookieFile);
        browser = l.browser;
      } else if (mode === 'real') {
        const l = await launchRealWindow(cookieFile);
        browser = l.browser;
      } else {
        browser = await tryConnect();
        if (browser) this.log(`✅ 会话 #${sessionNum}: 连接调试 Chrome (9222)`);
        else {
          const l = await launchRealWindow(cookieFile);
          browser = l.browser;
        }
      }
      page = await openLandingPage(browser, cookieFile);
      const st = await page.evaluate(() => ({
        bodyLen: document.body ? document.body.innerText.length : 0,
        hasLogin: !!document.querySelector('input[type=password]'),
      }));
      return st;
    };

    try {
      this.log('══════ 抓取开始 ══════');
      this.log(`关键词: ${keywords.length} 个 | 模式: ${mode} | 详情: ${detail ? '是' : '否'}`);

      let state = await openSession();
      this.log(`会话 #${sessionNum}: 内容 ${state.bodyLen} | 登录框: ${state.hasLogin}`);
      if (state.hasLogin || state.bodyLen < 200) {
        throw new Error('页面未正常加载：Cookie 可能失效或需要登录。请重新导出 Cookie。');
      }

      let creators = [];
      let details = [];
      let rateLimited = false;
      let cooldown = 120000; // start with 2 min

      // list scrape (with session auto-recovery)
      this.log('\n── 抓取达人列表 ──');
      for (let attempt = 0; attempt < 10 && !this.stopped; attempt++) {
        const res = await scrapeList(page, keywords, {
          resumeState: resumeList,
          isStopped: () => this.stopped,
          onProgress: (m) => this.log('  ' + m),
        });
        creators = res.creators;
        rateLimited = res.rateLimited;
        if (this.stopped) break;
        if (!rateLimited) break; // done
        // rate-limited: cooldown & restart browser
        this.log(`⚠️ 检测到限流/风控，等待 ${Math.round(cooldown / 1000)}s 后自动重启浏览器重试...`);
        await this.sleep(Math.min(cooldown, 30 * 60 * 1000));
        cooldown = Math.min(cooldown * 2, 30 * 60 * 1000);
        const st2 = await openSession();
        this.log(`会话 #${sessionNum} 重启完成: 内容 ${st2.bodyLen} | 登录框: ${st2.hasLogin}`);
        if (st2.hasLogin || st2.bodyLen < 200) {
          this.log('⚠️ 重启后页面仍异常，可能 Cookie 失效。请稍后重新导出 Cookie。');
          break;
        }
      }
      this.log(`\n✅ 列表阶段结束: ${creators.length} 条唯一达人`);

      // detail scrape
      if (detail && creators.length && !this.stopped) {
        this.log('\n── 抓取详情（简介/邮箱等）──');
        for (let attempt = 0; attempt < 10 && !this.stopped; attempt++) {
          const dr = await scrapeDetails(page, creators, {
            resumeFile: resumeDetail,
            isStopped: () => this.stopped,
            onProgress: (m) => this.log('  ' + m),
          });
          details = dr.details;
          rateLimited = dr.rateLimited;
          if (this.stopped || !rateLimited) break;
          this.log(`⚠️ 详情阶段限流，等待 ${Math.round(cooldown / 1000)}s 后自动重试...`);
          await this.sleep(Math.min(cooldown, 30 * 60 * 1000));
          cooldown = Math.min(cooldown * 2, 30 * 60 * 1000);
          await openSession();
        }
        this.log(`\n✅ 详情阶段结束: ${details.length} 条`);
      }

      // export
      const rows = mergeRows(creators, details);
      const headers = Object.keys(rows[0] || {});
      ensureDir(outPath);
      this.log(`\n── 导出 ${rows.length} 行 → ${outPath}`);
      if (format === 'xlsx') await exportXlsx(outPath, rows, headers);
      else await exportCsv(outPath, rows, headers);
      this.log('✅ 导出完成！');

      this.result = { ok: true, rows: rows.length, outPath, creators: creators.length, details: details.length };
      this.log('══════ 全部完成 ══════');
    } catch (e) {
      this.log('❌ 错误: ' + e.message);
      this.result = { ok: false, error: e.message };
    } finally {
      this.running = false;
      try { if (browser) browser.disconnect(); } catch (e) { }
    }
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  stop() {
    if (this.running) {
      this.stopped = true;
      this.log('收到停止请求，将在当前请求完成后停止...');
    }
  }
}

module.exports = { Runner };
