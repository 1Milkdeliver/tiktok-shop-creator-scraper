'use strict';
// One retained MY creator: native profile baseline with recommendations blocked,
// followed by at most ONE combined profile call. Never retry a restriction.
const puppeteer = require('puppeteer-core');
const {CreatorDatabase} = require('../lib/database');
const {decodeResponse} = require('../lib/partner-contacts');
const {SECTIONS, parseSection, permitted} = require('../lib/partner-profile');
const {blockDetailRecommendations} = require('../lib/partner-detail-network');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const [dbPath] = process.argv.slice(2);
  if (!dbPath) throw new Error('DB required');
  const report = {region:'MY',blockedRecommendations:0,profileRequests:0,combinedRequests:0,saved:false,productionChanged:false};
  let app, browser, db, page, blocker, restriction;
  const baseline = new Map(), pending = new Set();
  try {
    app = await puppeteer.connect({browserURL:'http://127.0.0.1:9333'});
    const ui = (await app.pages()).find(p => p.url().startsWith('file:'));
    const state = await ui.evaluate(async () => {
      const s = await api.status(), c = await api.partnerContactsStatus();
      return {running:s.running,waiting:s.verification?.waiting,contacts:c.running};
    });
    if (state.running || state.contacts || state.waiting) throw Object.assign(new Error(),{code:'BUSY'});
    browser = await puppeteer.connect({browserURL:'http://127.0.0.1:9222'});
    let partner;
    for (const p of await browser.pages()) {
      const u = new URL(p.url());
      if (u.origin !== 'https://partner.tiktokshop.com' || u.searchParams.get('market') !== '6') continue;
      partner = await p.evaluate(() => {
        for (const item of performance.getEntriesByType('resource')) {
          const url = new URL(item.name);
          if (url.pathname.endsWith('/4partner/find') && /^\d+$/.test(url.searchParams.get('partner_id') || '')) return url.searchParams.get('partner_id');
        }
        return null;
      });
      if (partner) break;
    }
    if (!partner) throw Object.assign(new Error(),{code:'CONTEXT'});
    db = new CreatorDatabase(dbPath); await db.open();
    const row = await db.get("SELECT creator_id FROM creators WHERE region='MY' AND json_extract(raw_json,'$.partner_profile_completed_at') IS NOT NULL ORDER BY rowid DESC LIMIT 1");
    if (!row || typeof row.creator_id !== 'string') throw Object.assign(new Error(),{code:'CONTEXT'});
    const id = row.creator_id;
    const root = await browser.target().createCDPSession();
    const {targetId} = await root.send('Target.createTarget',{url:'about:blank',background:true});
    const target = await browser.waitForTarget(t => t._targetId === targetId);
    page = await target.page(); await root.detach();
    blocker = await blockDetailRecommendations(page);
    blocker.on('Network.loadingFailed', e => {if (e.blockedReason === 'inspector') report.blockedRecommendations++;});
    let combined = false;
    page.on('request', r => {if (!combined && r.method()==='POST' && new URL(r.url()).pathname.endsWith('/4partner/profile')) report.profileRequests++;});
    page.on('response', response => {
      if (combined || response.request().method() !== 'POST' || !new URL(response.url()).pathname.endsWith('/4partner/profile')) return;
      const work = (async () => {
        const body = JSON.parse(response.request().postData() || '{}');
        if (String(body.creator_oec_id) !== id) return;
        const data = decodeResponse(response.status(),response.headers(),await response.text());
        baseline.set([...body.profile_types].sort().join(','),data);
      })().catch(error => {restriction = error.code || 'RESPONSE';});
      pending.add(work); work.finally(() => pending.delete(work));
    });
    const detail = new URL('https://partner.tiktokshop.com/affiliate-cmp/creator/detail');
    for (const [k,v] of Object.entries({cid:id,pid:partner,partner_id:partner,market:'6',enter_from:'creator_connect_page'})) detail.searchParams.set(k,v);
    const started = Date.now();
    await page.goto(detail.href,{waitUntil:'domcontentloaded',timeout:45000});
    const deadline = Date.now()+30000;
    while (!restriction && Date.now()<deadline && !SECTIONS.every(s => baseline.has([...s.types].sort().join(',')))) await sleep(250);
    await Promise.all([...pending]);
    report.baselineElapsedMs = Date.now()-started;
    report.baselineModules = SECTIONS.filter(s => baseline.has([...s.types].sort().join(','))).map(s => s.key);
    // Save all successful baseline responses even if another module was challenged.
    const stored = await db.updatePartnerProfile('MY',id,{partner_efficiency_baseline_json:JSON.stringify({checkedAt:new Date().toISOString(),responses:permitted(Object.fromEntries(baseline))})});
    if (stored.saved !== 1) throw Object.assign(new Error(),{code:'SAVE'});
    report.saved = true;
    if (restriction) throw Object.assign(new Error(),{code:restriction});
    if (report.baselineModules.length !== SECTIONS.length) throw Object.assign(new Error(),{code:'BASELINE_INCOMPLETE'});
    for (const section of SECTIONS) parseSection(baseline.get([...section.types].sort().join(',')),section,id,'MY');
    await sleep(15000);
    if (restriction) throw Object.assign(new Error(),{code:restriction});
    combined = true; report.combinedRequests = 1;
    const url = new URL('https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/profile');
    for (const [k,v] of Object.entries({partner_id:partner,aid:'360019',app_name:'i18n_ecom_alliance',device_platform:'web'})) url.searchParams.set(k,v);
    const began = Date.now();
    const raw = await page.evaluate(async (url,id) => {
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),20000);
      try {
        const res = await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({creator_oec_id:id,profile_types:[1,2,3,4,5,6]}),signal:controller.signal});
        return {status:res.status,headers:{'bdturing-verify':res.headers.get('bdturing-verify')||''},body:await res.text()};
      } finally {clearTimeout(timer);}
    },url.href,id);
    report.combinedElapsedMs = Date.now()-began;
    const data = decodeResponse(raw.status,raw.headers,raw.body);
    report.sections = SECTIONS.map(section => {
      const expected = parseSection(baseline.get([...section.types].sort().join(',')),section,id,'MY');
      try {
        const actual = parseSection(data,section,id,'MY');
        return {key:section.key,valid:true,missingPreviouslyAvailableFields:Object.keys(expected.status).filter(k=>expected.status[k]==='已获取' && actual.status[k]!=='已获取')};
      } catch {return {key:section.key,valid:false};}
    });
    const saved = await db.updatePartnerProfile('MY',id,{partner_efficiency_combined_json:JSON.stringify({checkedAt:new Date().toISOString(),response:permitted(data)})});
    if (saved.saved !== 1) throw Object.assign(new Error(),{code:'SAVE'});
    report.allModulesPresent = report.sections.every(s=>s.valid && !s.missingPreviouslyAvailableFields.length);
  } catch (error) {report.errorCode = error.code || 'PROBE_FAILED';}
  finally {
    // Leave the real page available; no automatic refresh, retry or collection resume.
    if (blocker) await blocker.detach().catch(()=>{});
    if (db) await db.close();
    if (browser) await browser.disconnect();
    if (app) await app.disconnect();
    console.log(JSON.stringify(report));
  }
}
main().catch(()=>{console.error('PROBE_SETUP_FAILED');process.exitCode=1;});
