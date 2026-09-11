'use strict';
// Opt-in real production-pipeline test. No synthetic creators or contact values.
// Test-only wrappers bound discovery; production pacing, parsing and DB hooks stay intact.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
const {performance} = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const emit = value => { try { process.stdout.write(JSON.stringify(value) + '\n'); } catch (_) {} };
process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
// Existing runner logs can include identities; never forward them into diagnostics.
console.log = () => {}; console.error = () => {};
const keys = ['creator_oecuid','handle','nickname','selection_region','follower_cnt','category',
  'video_avg_view_cnt','video_play_cnt_med','video_engagement','ec_video_engagement','video_gmv',
  'live_gmv','med_gmv_revenue','med_gmv_revenue_range','units_sold','units_sold_range','ec_video_gpm',
  'ec_live_gpm','ec_live_avg_uv','top_follower_ages','top_follower_gender','pps_score','is_fast_growing',
  'has_collaborated','creator_permission_tag','is_live_auction','last_publish_time','简介','合作邮箱',
  'mcn','类目','垂直类目','whatsapp','line','zalo','viber','facebook','other_contacts',
  'whatsapp_country_code','line_country_code','zalo_country_code','viber_country_code'];
const present = value => value !== null && value !== undefined &&
  (typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 :
    typeof value === 'object' ? Object.keys(value).length > 0 : true);
function coverage(rows) { return Object.fromEntries(keys.map(key => [key, rows.filter(row => present(row[key])).length])); }
async function main() {
  const [approval, sessionArgument = '0', phaseArgument = 'full', regionArgument = 'MY', limitArgument = '100', cookieFileArgument = ''] = process.argv.slice(2);
  if (approval !== '--write-library' || !/^(\d|partner|file)$/.test(sessionArgument) || !['full','contacts-only'].includes(phaseArgument) || !/^(MY|TH|SG)$/.test(regionArgument) || !/^\d+$/.test(limitArgument)) throw new Error('Explicit approval required');
  const partnerRoute=sessionArgument==='partner'||sessionArgument==='file';
  const includeDetail=phaseArgument==='full';
  const limit = Number(limitArgument), region = regionArgument, started = performance.now();
  if (limit < 1 || limit > 5000) throw new Error('Invalid target limit');
  const directory = path.join(root, 'test-results', region.toLowerCase()+'-stream-'+limit+'-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, {recursive:true});
  const report = {startedAt:new Date().toISOString(), region, target:limit,
    sourceCommit:require('node:child_process').execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    contactModuleSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'lib','partner-contacts.js'))).digest('hex'),
    mode:'real', detail:includeDetail, contactIntervalMs:10000, keyword:'', selected:0,
    listRequests:0, detailRequests:0, detailSuccesses:0, contactRequests:0, contactSuccesses:0,
    saved:0, newCreators:0, whatsapp:0, email:0, line:0, emptyContacts:0,
    errors:[], listDurationsMs:[], detailDurationsMs:[], contactDurationsMs:[],
    contactsBeforeProducerFinished:0, chatPagesOpened:0, followupContactJobs:0, completed:false,
    discoveryRoute:partnerRoute?'observed_partner_test_adapter':'production_seller',productionEntryPointUnchanged:true};
  const events = [], admitted = new Set(), fresh = new Map(), detailRows = new Map(), patches = new Map();
  const stamp = (kind, extra = {}) => events.push({kind, elapsedMs:Math.round(performance.now()-started), ...extra});
  let runner, job, db, timer, deadline, producerFinished = false, lastDetailId = '';
  const saveReport = () => fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2));
  const stop = code => {
    if (!report.errors.includes(code)) report.errors.push(code);
    if (runner) { runner.stopped=true; runner.detailStopped=true; runner.paused=false; runner.clearAutoResume(); }
    job?.stop();
    stamp('stopped', {code});
  };
  try {
    const contacts = require('../lib/partner-contacts');
    const appPath = path.join(process.env.APPDATA,'tiktok-shop-creator-scraper','app-data.json');
    const storedAppData=sessionArgument==='file'?null:JSON.parse(fs.readFileSync(appPath,'utf8'));
    const savedIndex=partnerRoute?0:Number(sessionArgument);
    const rawCookies=sessionArgument==='file'
      ? fs.readFileSync(path.resolve(cookieFileArgument),'utf8')
      : storedAppData.cookies[savedIndex];
    const providedCookies=require('../lib/account-cookies').parse(rawCookies);
    const client = new contacts.PartnerContactClient(providedCookies);
    await client.resolvePartner(region); report.partnerAuthorized=true; stamp('partner_authorized');
    const sellerCookies = providedCookies;
    if (!Array.isArray(sellerCookies) || !sellerCookies.length) throw new Error('Seller session unavailable');
    const cookieModule = require('../lib/cookies'), loadCookies = cookieModule.loadCookies;
    cookieModule.loadCookies = source => source === 'live-test-saved-session' ? sellerCookies : loadCookies(source);
    const browserModule = require('../lib/browser'), originalFinder = browserModule.makeXhrFinder;
    let listContract,firstList;
    if(partnerRoute) browserModule.openLandingPage=async browser=>{
      const converted=cookieModule.toPuppeteerCookies(providedCookies);
      await browser.defaultBrowserContext().setCookie(...converted);
      const imported=await browser.defaultBrowserContext().cookies();
      report.importedCookieCount=imported.length;
      report.importedCookieValuesMatch=converted.every(c=>imported.some(i=>i.name===c.name&&i.domain===c.domain&&i.value===c.value));
      if(!report.importedCookieValuesMatch)throw new Error('Cookie import mismatch');
      const page=await browser.newPage();
      const responsePromise=page.waitForResponse(res=>res.status()===200&&res.request().method()==='POST'&&
        new URL(res.url()).pathname==='/api/v1/oec/affiliate/creator/marketplace/4partner/find',{timeout:45000});
      await page.goto('https://partner.tiktokshop.com/affiliate-cmp/creator?market=6',{waitUntil:'domcontentloaded',timeout:45000});
      const response=await responsePromise; firstList=await response.text();
      const url=new URL(response.url());
      // Reuse the page's own SDK; never forge/replay per-request signature values.
      for(const key of ['msToken','X-Bogus','_signature','X-Tts-Oec-Bsid'])url.searchParams.delete(key);
      listContract={url:url.href,body:JSON.parse(response.request().postData())};
      stamp('partner_browser_ready'); return {page,sellerId:''};
    };
    browserModule.makeXhrFinder = (page, api, sellerId) => {
      const fetch = partnerRoute?async body=>{
        if(api.endsWith('/profile')){
          if(!includeDetail)throw new Error('Unexpected detail request in contacts-only test');
          return JSON.stringify(await client.fetchProfileSection(region,String(body.creator_oec_id),body.profile_types));
        }
        if(firstList){const raw=firstList;firstList=null;return raw;}
        return page.evaluate(async(url,body)=>{
          const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),30000);
          try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body),signal:ctrl.signal});
            if(res.status!==200||res.headers.has('bdturing-verify'))return JSON.stringify({err:'HTTP_OR_VERIFICATION',httpStatus:res.status});
            return await res.text();
          }finally{clearTimeout(timer);}
        },listContract.url,{...listContract.body,...body});
      }:originalFinder(page,api,sellerId);
      return async body => {
        if (report.errors.length) return JSON.stringify({err:'TEST_STOPPED'});
        const detail = api.endsWith('/profile'), t=performance.now();
        report[detail?'detailRequests':'listRequests']++;
        if (detail) lastDetailId=String(body.creator_oec_id);
        let raw;
        try { raw=await fetch(body); }
        catch(error){stop('REQUEST_'+(error.code||'NETWORK'));return JSON.stringify({err:'TEST_REQUEST_FAILED'});}
        finally { report[detail?'detailDurationsMs':'listDurationsMs'].push(Math.round(performance.now()-t)); }
        try {
          const result=JSON.parse(raw);
          if (result.code !== 0 || result.err) stop('SELLER_API_' + (/^\d+$/.test(String(result.code)) ? result.code : 'INVALID_RESPONSE'));
          else if (detail) {
            const profile=result.creator_profile||result.data?.creator_profile;
            if(!profile||!Object.keys(profile).length){stop('PROFILE_FIELDS_MISSING');return JSON.stringify({err:'PROFILE_FIELDS_MISSING'});}
            const {permitted}=require('../lib/partner-profile');
            raw=JSON.stringify({...result,creator_profile:permitted(profile)});
            report.detailSuccesses++; stamp('detail_received');
          }
          else {
            stamp('list_received', {returned:(result.creator_profile_list||[]).length});
            raw=JSON.stringify(require('../lib/partner-profile').permitted(result));
          }
        } catch (_) { stop('SELLER_RESPONSE_INVALID'); }
        return raw;
      };
    };
    const scraper = require('../lib/scraper'), scrapeList=scraper.scrapeList, extract=scraper.extractDetailFields;
    scraper.extractDetailFields = profile => {
      const row=extract(profile); detailRows.set(lastDetailId,row); return row;
    };
    scraper.scrapeList = (page,keywords,options) => scrapeList(page,keywords,{...options,
      // Truncate only the last page's NEW batch; no generated data or changed API responses.
      isStopped:() => admitted.size >= limit || options.isStopped?.(),
      onCreatorsDiscovered:async rows => {
        rows.splice(Math.max(0,limit-admitted.size));
        if (rows.some(row => String(row.selection_region||'').toUpperCase() !== region)) {
          stop('SELLER_MARKET_NOT_MY'); rows.splice(0); throw new Error('Market mismatch');
        }
        for (const row of rows) { admitted.add(String(row.creator_oecuid)); fresh.set(String(row.creator_oecuid),{...row}); }
        report.selected=admitted.size;
        await options.onCreatorsDiscovered(rows);
        stamp('base_committed',{selected:admitted.size});
      }
    }).then(result=>({...result,creators:result.creators.filter(row=>admitted.has(String(row.creator_oecuid)))}));
    const {CreatorDatabase}=require('../lib/database');
    const databaseFile=path.join(process.env.APPDATA,'tiktok-shop-creator-scraper','data','creators.db');
    db=new CreatorDatabase(databaseFile); await db.open();
    report.rowsBefore=(await db.get('SELECT count(*) AS n FROM creators')).n;
    report.preexistingRegion=(await db.get('SELECT count(*) AS n FROM creators WHERE region=?',[region])).n;
    const beforeIds=new Set(await db.getCreatorIds(region));
    await db.run('VACUUM INTO ?', [path.join(directory,'library-before.db')]);
    report.backupCreated=true;
    const native=createRequire(path.join(root,'main.js'));
    const context={fixtureDb:db,fixtureClient:client,writeLog(){},recordHistory(){},appData:{},
      require:name=>name==='electron'?{}:native(name)};
    vm.createContext(context);
    const hooks=fs.readFileSync(path.join(root,'main.js'),'utf8').split('// ---- app folders:')[0];
    vm.runInContext(hooks+'\ncreatorDb=fixtureDb;partnerContactClient=fixtureClient;',context);
    runner=vm.runInContext('runner',context); job=vm.runInContext('contactJob',context);
    if (partnerRoute) {
      // Exercise the production Partner discovery path. Bound only the returned
      // live sample; do not synthesize creators or replay captured responses.
      runner.partnerCredential=client;
      const findCreators=client.findCreators.bind(client);
      client.findCreators=async(...args)=>{
        const t=performance.now(); report.listRequests++;
        try {
          const result=await findCreators(...args);
          const remaining=Math.max(0,limit-admitted.size);
          result.profiles=(result.profiles||[]).slice(0,remaining);
          if (result.profiles.length>=remaining) result.pagination={...result.pagination,has_more:false};
          stamp('list_received',{returned:result.profiles.length});
          return result;
        } finally { report.listDurationsMs.push(Math.round(performance.now()-t)); }
      };
      const fetchProfileSection=client.fetchProfileSection.bind(client);
      client.fetchProfileSection=async(...args)=>{
        const t=performance.now(); report.detailRequests++;
        try { const result=await fetchProfileSection(...args); report.detailSuccesses++; stamp('detail_received'); return result; }
        finally { report.detailDurationsMs.push(Math.round(performance.now()-t)); }
      };
      const persist=runner.onDataReady;
      runner.onDataReady=async(rows,config)=>{
        for(const row of rows||[]){
          const id=String(row.creator_oecuid||'');
          if(id){admitted.add(id);fresh.set(id,{...(fresh.get(id)||{}),...row});}
        }
        report.selected=admitted.size; stamp('base_committed',{selected:report.selected});
        return persist(rows,config);
      };
    }
    runner.log=message => {
      if (/^会话 #\d+ 启动失败:/.test(message)) {
        report.startupReason=String(message).replace(/[A-Za-z]:\\[^\r\n]*/g,'[PATH]').replace(/https?:\/\/\S+/g,'[URL]').slice(0,300);
        stop('SELLER_START_FAILED');
      }
      if (/Cookie 无效或已过期/.test(message)) stop('SELLER_AUTH');
    };
    runner.scheduleAutoResume=()=>stop('SELLER_VERIFICATION_OR_LIMIT');
    const fetchContacts=client.fetchContacts.bind(client);
    client.fetchContacts=async(...args)=>{
      const t=performance.now(); report.contactRequests++; stamp('contact_started');
      try {
        const patch=await fetchContacts(...args); patches.set(args[1],patch);
        report.contactSuccesses++;
        report.whatsapp=[...patches.values()].filter(p=>present(p.whatsapp)).length;
        report.email=[...patches.values()].filter(p=>present(p['合作邮箱'])).length;
        report.line=[...patches.values()].filter(p=>present(p.line)).length;
        report.emptyContacts=[...patches.values()].filter(p=>p.contact_status==='未提供').length;
        if (!producerFinished) report.contactsBeforeProducerFinished++;
        stamp('contact_received'); return patch;
      } catch(error) { stop('CONTACT_'+(error.code||'UNKNOWN')); throw error; }
      finally { report.contactDurationsMs.push(Math.round(performance.now()-t)); }
    };
    const config={cookieFiles:partnerRoute?[]:['live-test-saved-session'],discoverySource:partnerRoute?'partner':'seller',shopRegion:region,mode:'real',keywords:[''],
      detail:includeDetail,format:'xlsx',outPath:directory,autoExport:false,dedupe:true,existingIds:includeDetail?[]:[...beforeIds],
      resume:false,testMode:false,enrichContacts:true,partnerBrowserSession:partnerRoute,
      libraryUpdate:includeDetail,testLabel:region+' real stream benchmark'};
    config.databaseJobId=await db.createScrapeJob(config); report.jobId=config.databaseJobId;
    runner._currentJobId=config.databaseJobId; runner._lastConfig=config;
    timer=setInterval(()=>{
      report.elapsedMs=Math.round(performance.now()-started);
      report.contactsSaved=job.state.completed||0; report.contactOutcome=job.state.outcome;
      saveReport(); emit({selected:report.selected,details:report.detailSuccesses,contacts:report.contactsSaved,whatsapp:report.whatsapp,email:report.email,empty:report.emptyContacts,elapsedMs:report.elapsedMs,errors:report.errors});
    },15000);
    const deadlineMinutes=Math.max(40,Math.ceil(limit*12/60)+20);
    deadline=setTimeout(()=>stop('TEST_DEADLINE_'+deadlineMinutes+'_MINUTES'),deadlineMinutes*60000);
    stamp('runner_started'); await runner.start(config);
    producerFinished=true; report.producerFinishedMs=Math.round(performance.now()-started); stamp('producer_finished');
    report.sellerResult={ok:runner.result?.ok,creators:runner.result?.creators||0,details:runner.result?.details||0,errorCode:runner.result?.errorCode||null,
      error:runner.result?.error?String(runner.result.error).replace(/[A-Za-z]:\\[^\r\n]*/g,'[PATH]').replace(/https?:\/\/\S+/g,'[URL]').slice(0,300):null};
    await job.done; stamp('contacts_finished');
    report.contactOutcome=job.state.outcome; report.contactsSaved=job.state.completed||0;
    const storedRows=[], freshRows=[];
    for (const id of admitted) {
      const record=await db.get('SELECT raw_json FROM creators WHERE region=? AND creator_id=?',[region,id]);
      if (record) storedRows.push(JSON.parse(record.raw_json));
      freshRows.push({...fresh.get(id),...detailRows.get(id),...patches.get(id)});
      if (!beforeIds.has(id) && record) report.newCreators++;
    }
    report.saved=storedRows.length; report.freshFieldCoverage=coverage(freshRows); report.storedFieldCoverage=coverage(storedRows);
    report.whatsapp=freshRows.filter(r=>present(r.whatsapp)).length;
    report.email=freshRows.filter(r=>present(r['合作邮箱'])).length;
    report.line=freshRows.filter(r=>present(r.line)).length;
    report.emptyContacts=[...patches.values()].filter(r=>r.contact_status==='未提供').length;
    report.retainedCheckedContacts=storedRows.filter(r=>r.contact_checked_at&&!patches.has(String(r.creator_oecuid))).length;
    report.readbackVerified=patches.size>0&&[...patches].every(([id,patch])=>{
      const row=storedRows.find(r=>String(r.creator_oecuid)===id);
      return row&&Object.entries(patch).every(([key,value])=>row[key]===value);
    });
    report.rowsAfter=(await db.get('SELECT count(*) AS n FROM creators')).n;
    report.databaseIntegrity=Object.values(await db.get('PRAGMA quick_check'))[0];
    report.completed=report.selected===limit&&report.saved===limit&&runner.result?.ok&&job.state.outcome==='completed'&&!report.errors.length&&
      report.contactsSaved===limit&&report.contactSuccesses===limit&&(!includeDetail||report.detailRequests>0);
    await db.finishScrapeJob(config.databaseJobId,{ok:report.completed,creators:report.selected,
      database:{saved:report.saved},error:report.completed?null:(report.errors.join(',')||'TEST_INCOMPLETE')});
    report.contactTailMs=Math.max(0,Math.round(performance.now()-started)-report.producerFinishedMs);
    if (storedRows.length) {
      const {exportCsv,exportXlsx}=require('../lib/exporter');
      const headers=[...keys,'contact_status','contact_checked_at','contact_source'];
      await exportCsv(path.join(directory,'creators-retained.csv'),storedRows,headers);
      await exportXlsx(path.join(directory,'creators-retained.xlsx'),storedRows,headers);
    }
  } catch(error) {
    stop(error.code&&/^[A-Z_]+$/.test(error.code)?error.code:'LOCAL_TEST_FAILURE');
  } finally {
    clearInterval(timer); clearTimeout(deadline);
    if (job?.state.running) { job.stop(); await job.done.catch(()=>{}); }
    if (db) await db.close().catch(()=>{});
    report.finishedAt=new Date().toISOString(); report.elapsedMs=Math.round(performance.now()-started);
    fs.writeFileSync(path.join(directory,'timing-events.json'),JSON.stringify(events,null,2)); saveReport();
    emit({directory,...report});
    process.exitCode=report.completed?0:1;
  }
}
main().catch(()=>{emit({error:'LOCAL_PREFLIGHT_FAILED'});process.exitCode=1;});
