'use strict';
// One opt-in diagnostic request through the existing browser session.
// Do not run concurrently with collection; retain authorized results in its DB.
const puppeteer=require('puppeteer-core');
const {CreatorDatabase}=require('../lib/database');
const {decodeResponse}=require('../lib/partner-contacts');
const {SECTIONS,parseSection,permitted}=require('../lib/partner-profile');
const {codes,backend}=require('../lib/partner-markets');
async function main(){
  const [appPort,browserPort,dbPath,region]=process.argv.slice(2);
  if(!/^\d+$/.test(appPort||'')||!/^\d+$/.test(browserPort||'')||!dbPath||!Object.hasOwn(codes,region))
    throw new Error('Pass app port, collection browser port, retained DB path and market');
  let app,browser,db,ui,pausedByProbe=false,restricted=false;
  const report={kind:'one-request-profile-combination',region,requests:0,saved:false,productionDefaultsChanged:false};
  try{
    app=await puppeteer.connect({browserURL:'http://127.0.0.1:'+appPort});
    ui=(await app.pages()).find(p=>p.url().startsWith('file:'));
    const state=await ui.evaluate(()=>window.api.status());
    if(!state.running||state.paused||state.verification?.waiting)throw Object.assign(new Error('Busy'),{code:'BUSY'});
    await ui.evaluate(()=>window.api.pause());pausedByProbe=true;
    await new Promise(resolve=>setTimeout(resolve,25000)); // Drain current request, not a new task.
    const gate=await ui.evaluate(()=>window.api.status());
    if(!gate.running||!gate.paused||gate.verification?.waiting)throw Object.assign(new Error('Busy'),{code:'BUSY'});
    browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+browserPort});
    const page=(await browser.pages()).find(p=>{
      try{const u=new URL(p.url());return u.pathname==='/affiliate-cmp/creator/detail'&&u.searchParams.get('market')===String(codes[region]);}catch{return false;}
    });
    if(!page)throw Object.assign(new Error('Market context unavailable'),{code:'CONTEXT'});
    const context=new URL(page.url()),id=context.searchParams.get('cid'),partner=context.searchParams.get('partner_id');
    if(!/^\d{1,30}$/.test(id||'')||!/^\d{1,30}$/.test(partner||''))throw Object.assign(new Error('Context'),{code:'CONTEXT'});
    db=new CreatorDatabase(dbPath);await db.open();
    const old=await db.partnerProfileRaw(region,id);
    if(!old)throw Object.assign(new Error('Creator missing from retained DB'),{code:'SAVE'});
    const url=new URL(backend(region)+'/api/v1/oec/affiliate/creator/marketplace/4partner/profile');
    for(const [k,v]of Object.entries({partner_id:partner,aid:'360019',app_name:'i18n_ecom_alliance',device_platform:'web'}))url.searchParams.set(k,v);
    // No manually supplied Cookie/signature or verification token. The page owns authentication.
    report.requests=1;const started=Date.now();
    const raw=await page.evaluate(async(url,id)=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      try{
        const response=await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({creator_oec_id:id,profile_types:[1,2,3,4,5,6]}),signal:controller.signal});
        return {status:response.status,headers:{'bdturing-verify':response.headers.get('bdturing-verify')||'',
          'retry-after':response.headers.get('retry-after')||''},body:await response.text()};
      }finally{clearTimeout(timer);}
    },url.href,id);
    report.elapsedMs=Date.now()-started;
    const response=decodeResponse(raw.status,raw.headers,raw.body);
    const sections=[];const patch={};
    for(const section of SECTIONS){
      try{const parsed=parseSection(response,section,id,region);Object.assign(patch,parsed.patch);sections.push({section:section.key,valid:true,fields:Object.values(parsed.status).filter(x=>x==='已获取').length});}
      catch{sections.push({section:section.key,valid:false});}
    }
    report.sections=sections;
    // Save diagnostic payload without overwriting production field/checkpoint values.
    const saved=await db.updatePartnerProfile(region,id,{partner_capacity_probe_json:JSON.stringify({
      checkedAt:new Date().toISOString(),types:[1,2,3,4,5,6],response:permitted(response)})});
    if(saved?.saved!==1)throw Object.assign(new Error('Save failed'),{code:'SAVE'});
    report.saved=true;report.allModulesReturned=sections.every(s=>s.valid);
  }catch(error){
    restricted=['CHALLENGE','RATE_LIMIT','AUTH','QUOTA'].includes(error.code);
    report.errorCode=['BUSY','CONTEXT','SAVE','CHALLENGE','RATE_LIMIT','AUTH','QUOTA','RESPONSE','HTTP','API'].includes(error.code)?error.code:'PROBE_FAILED';
  }finally{
    if(db)await db.close();
    if(pausedByProbe&&ui&&!restricted){
      const s=await ui.evaluate(()=>window.api.status()).catch(()=>null);
      if(s?.running&&s.paused&&!s.verification?.waiting){await ui.evaluate(()=>window.api.resume());report.collectionResumed=true;}
    }
    if(restricted)report.collectionLeftPaused=true;
    if(browser)await browser.disconnect();if(app)await app.disconnect();
    console.log(JSON.stringify(report));
  }
}
main().catch(()=>{console.error(JSON.stringify({errorCode:'PROBE_SETUP'}));process.exitCode=1;});
