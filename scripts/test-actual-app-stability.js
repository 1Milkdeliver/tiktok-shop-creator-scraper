'use strict';
// Operates the real renderer Start button. No substitute scraper or generated rows.
const fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
const {audit}=require('./audit-active-partner-job');
const {pauseForStabilityRestriction}=require('./stability-pause');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve(__dirname,'..');
const requestedTarget=Number(process.env.STABILITY_TARGET||process.argv[2]||100);
if(!Number.isInteger(requestedTarget)||requestedTarget<1||requestedTarget>5000) throw new Error('Invalid stability target');
const output=path.join(root,'test-results','actual-app-stability-'+requestedTarget+'-20260910.json');
const database=path.join(root,'test-results','actual-app-profile-20260910','data','creators.db');
async function main(){
  let app,browser,ui;
  const observing=process.argv.includes('--observe-existing');
  const existing=observing?JSON.parse(fs.readFileSync(output,'utf8')):null;
  const started=existing?Date.parse(existing.startedAt):Date.now(),report=existing||{startedAt:new Date().toISOString(),region:'MY',target:requestedTarget,maxMinutes:120,
    entry:'real-renderer-start-button',detail:true,contacts:true,dedupe:true,keywords:['beauty','fashion','tech'],
    network:{profilePosts:0,listPosts:0,contactPosts:0,recommendationBlocked:0,challenges:0,rateLimits:0,failed:0},
    samples:[],finished:false};
  const watched=new Set();
  const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
  const attach=async page=>{
    if(!page||watched.has(page))return;watched.add(page);
    const kind=url=>{const p=new URL(url).pathname;return p.endsWith('/4partner/profile')?'profilePosts':p.endsWith('/4partner/find')?'listPosts':p.endsWith('/cmp/contact')?'contactPosts':null;};
    page.on('request',r=>{const k=kind(r.url());if(k&&r.method()==='POST')report.network[k]++;});
    page.on('response',r=>{if(!kind(r.url())||r.request().method()!=='POST')return;const h=r.headers();if(h['bdturing-verify'])report.network.challenges++;if(r.status()===429)report.network.rateLimits++;});
    // Puppeteer reports no errorText for CDP inspector blocking; classify by the
    // actual CDP reason, rather than miscounting intentionally suppressed finds.
    const client=await page.createCDPSession(),requests=new Map();
    await client.send('Network.enable');
    client.on('Network.requestWillBeSent',e=>{const k=kind(e.request.url);if(k)requests.set(e.requestId,k);});
    client.on('Network.loadingFinished',e=>requests.delete(e.requestId));
    client.on('Network.loadingFailed',e=>{
      const k=requests.get(e.requestId);requests.delete(e.requestId);if(!k)return;
      if(k==='listPosts'&&e.blockedReason==='inspector')report.network.recommendationBlocked++;
      else report.network.failed++;
    });
  };
  try{
    app=await puppeteer.connect({browserURL:'http://127.0.0.1:9333'});
    ui=(await app.pages()).find(p=>p.url().startsWith('file:'));
    const port=process.env.STABILITY_BROWSER_PORT||'9222';
    browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+port});
    if(observing){report.previousPartialNetwork=report.network;report.network={profilePosts:0,listPosts:0,contactPosts:0,recommendationBlocked:0,challenges:0,rateLimits:0,failed:0};}
    report.previousPartialNetworkCaveat='Earlier Puppeteer failed counts include intentional inspector-blocked recommendations; not API failures.';
    report.networkObservedSince=new Date().toISOString();
    report.networkCoverage='partial-browser-only; direct contact HTTPS is not visible here';
    browser.on('targetcreated',target=>{target.page().then(attach).catch(()=>{});});
    for(const page of await browser.pages())await attach(page);
    const initial=await ui.evaluate(async()=>{const s=await api.status(),c=await api.partnerContactsStatus();return {busy:s.running||c.running,connected:c.connected};});
    if(!observing&&(initial.busy||!initial.connected))throw new Error('APP_NOT_READY');
    if(!observing){
    report.baseline=await audit(database);save();
    const launched=await ui.evaluate(async()=>{
      for(const [name,value]of [['source','cat'],['scrapeMode','full'],['dedupeMode','dedupe'],['mode','auto']]){
        const el=document.querySelector(`input[name="${name}"][value="${value}"]`);if(!el)throw new Error('Missing control');el.click();
      }
      document.getElementById('shopRegion').value='MY';document.getElementById('shopRegionCustom').value='';
      document.getElementById('discoverySource').value='partner';
      document.getElementById('autoContacts').checked=true;
      for(const x of document.querySelectorAll('.kw'))x.checked=['beauty','fashion','tech'].includes(x.value);
      for(const x of document.querySelectorAll('.update-group,.fld'))x.checked=true;
      document.getElementById('outPath').value='./test-results/stability-output-20260910';
      window.__stabilityTarget = requestedTarget;
      // Use the same IPC entry as the UI, with a test-only stop target. The
      // packaged UI never sends this optional field.
      const original = window.api.start;
      window.api.start = cfg => original({...cfg,testStopAfter:window.__stabilityTarget});
      await document.getElementById('btnStart').onclick();
      const s=await api.status();return {running:s.running};
    });
    report.launched=launched;save();console.log(JSON.stringify({started:launched.running,target:requestedTarget,region:'MY'}));
    }
    let lastAudit=0;
    while(Date.now()-started<120*60*1000){
      const state=await ui.evaluate(async()=>{
        const s=await api.status(),c=await api.partnerContactsStatus();
        return {running:s.running,paused:s.paused,waiting:!!s.verification?.waiting,rateLimited:!!s.rateLimit,
          completed:s.currentInfo?.completed,contactsRunning:c.running,contactCompleted:c.completed,
          contactFound:c.found,contactEmpty:c.empty,contactOutcome:c.outcome,retryCount:c.retryCount,
          result:s.result?{ok:s.result.ok,rows:s.result.rows}:null};
      });
      report.state=state;report.elapsedSeconds=Math.round((Date.now()-started)/1000);
      const restricted=state.waiting||state.rateLimited||report.network.challenges>0||report.network.rateLimits>0;
      if(restricted){
        report.stopReason=state.waiting||report.network.challenges?'verification':'rate-limit';
        // Preserve verification page and task checkpoint; no automatic resume.
        await pauseForStabilityRestriction(ui);
      }
      if(Date.now()-lastAudit>60000||restricted||(!state.running&&!state.contactsRunning)){
        report.audit=await audit(database);lastAudit=Date.now();
        const sample={seconds:report.elapsedSeconds,rows:report.audit.rows,profiles:report.audit.profilesCompletedThisRun,
          contacts:report.audit.contactsCheckedThisRun,whatsapp:report.audit.fieldCounts.whatsapp?.present,...state};
        report.samples.push(sample);save();console.log(JSON.stringify(sample));
      }
      if(restricted)break;
      if(!state.running&&!state.contactsRunning){report.stopReason=state.result?.ok?'task-complete':'task-ended';break;}
      save();await sleep(5000);
    }
    if(!report.stopReason){await ui.evaluate(()=>api.stop());report.stopReason='30-minute-observation-limit';}
    report.finished=true;report.finishedAt=new Date().toISOString();save();
  }catch(error){report.stopReason='test-controller-error';report.errorCode=error.code||'CONTROLLER';save();console.log(JSON.stringify({error:report.errorCode}));}
  finally{if(browser)await browser.disconnect();if(app)await app.disconnect();}
}
main().catch(()=>{console.error('STABILITY_SETUP_FAILED');process.exitCode=1;});
