'use strict';
// Bounded, opt-in diagnostic. No credentials/signatures are copied into output.
const puppeteer=require('puppeteer-core');
const {CreatorDatabase}=require('../lib/database');
const {decodeResponse}=require('../lib/partner-contacts');
const {listRow}=require('../lib/partner-discovery');
const {permitted}=require('../lib/partner-profile');
const {probeListCapacity}=require('../lib/collection-capacity-probe');
const {visibleState,frontend,withActiveListPage}=require('../lib/partner-browser');
const {codes}=require('../lib/partner-markets');
const fail=code=>Object.assign(new Error(code),{code});
async function main(){
  const [appPort,browserPort,dbPath,region,mode='fetch-descending']=process.argv.slice(2);
  if(!['fetch-descending','xhr-once100','xhr-once24'].includes(mode))throw fail('SETUP');
  if(!/^\d+$/.test(appPort||'')||!/^\d+$/.test(browserPort||'')||!dbPath||!Object.hasOwn(codes,region))throw fail('SETUP');
  let app,browser,page,db,listener,keepPage=false;
  const once=mode.startsWith('xhr-once');
  const retainedIds=new Set();
  const summary={region,mode,direction:'descending',sizes:once?[mode==='xhr-once24'?24:100]:[100,50,24,12],baselineRequests:0,retainedRows:0,newCreators:0,defaultsChanged:false};
  try{
    summary.stage='connect-app';
    app=await puppeteer.connect({browserURL:'http://127.0.0.1:'+appPort});
    const ui=(await app.pages()).find(p=>p.url().startsWith('file:'));
    const gate=async()=>{
      const s=await ui.evaluate(()=>window.api.status());
      const c=await ui.evaluate(()=>window.api.partnerContactsStatus());
      if((s.running&&!s.paused)||s.verification?.waiting||(c.running&&!c.collectionPaused))throw fail('BUSY');
      summary.collectionLeftPaused=!!s.paused;
      summary.collectionIdle=!s.running;
      if(page){
        const u=new URL(page.url());
        if(u.origin!==frontend(region)||u.searchParams.get('market')!==String(codes[region]))throw fail('MARKET_AUTH');
        const state=await visibleState(page);
        if(state.challenge)throw fail('CHALLENGE');if(state.login)throw fail('AUTH');
      }
    };
    await gate();
    summary.stage='open-database';
    db=new CreatorDatabase(dbPath);await db.open();
    const job=await db.get('SELECT id,region FROM scrape_jobs ORDER BY started_at DESC LIMIT 1');
    if(job?.region!==region)throw fail('MARKET_AUTH');
    const retainRows=async rows=>{
      for(const raw of rows){
        const mapped=listRow(raw,region),id=mapped.creator_oecuid;
        const old=await db.partnerProfileRaw(region,id);
        let saved;
        if(old)saved=await db.updatePartnerProfile(region,id,{partner_discovery_capacity_json:JSON.stringify(permitted(raw))});
        else {saved=await db.upsertCreators([mapped],{region,jobId:job.id,preserveContacts:true});summary.newCreators++;}
        if(saved?.saved!==1)throw fail('SAVE');summary.retainedRows++;retainedIds.add(id);
      }
    };
    summary.stage='connect-browser';
    browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+browserPort});
    // Separate background target avoids changing the production list's position.
    summary.stage='create-background-page';
    const root=await browser.target().createCDPSession();
    const {targetId}=await root.send('Target.createTarget',{url:'about:blank',background:true});
    const target=await browser.waitForTarget(t=>t._targetId===targetId,{timeout:10000});
    page=await target.page();await root.detach();
    let resolve,reject,timer;
    const baseline=new Promise((res,rej)=>{resolve=res;reject=rej;timer=setTimeout(()=>rej(fail('TIMEOUT')),30000);});
    // Observe the actual main-list request body, not detail recommendations.
    listener=async response=>{
      let matched=false;
      try{
        const request=response.request(),u=new URL(request.url());
        if(request.method()!=='POST'||!u.pathname.endsWith('/4partner/find'))return;
        matched=true;
        page.off('response',listener);summary.baselineRequests++;
        const body=JSON.parse(request.postData()||'{}');
        const decoded=decodeResponse(response.status(),response.headers(),await response.text());
        const data=decoded.data?.creator_profile_list?decoded.data:decoded;
        if(!Array.isArray(data.creator_profile_list)||!data.next_pagination)throw fail('RESPONSE');
        await retainRows(data.creator_profile_list);
        // Authentication stays in the browser. Do not replay captured tokens.
        const clean=new URL(u.origin+u.pathname);
        for(const key of ['partner_id','aid','app_name','device_platform'])if(u.searchParams.has(key))clean.searchParams.set(key,u.searchParams.get(key));
        resolve({url:clean.href,body,returned:data.creator_profile_list.length});
      }catch(error){reject(error);}finally{if(matched)clearTimeout(timer);}
    };
    page.on('response',listener);
    // Attach handlers before navigating; the promise is always observed.
    summary.stage='observe-baseline';
    const [observed]=await Promise.all([baseline,page.goto(frontend(region)+'/affiliate-cmp/creator?market='+codes[region],{waitUntil:'domcontentloaded',timeout:30000})]);
    summary.baseline={requested:observed.body.pagination?.size,returned:observed.returned};
    console.log(JSON.stringify({phase:'baseline',...summary.baseline,region}));
    await new Promise(r=>setTimeout(r,15000));
    if(mode==='xhr-once24'){
      await gate();summary.stage='native-scroll';
      const before=retainedIds.size,events=[],pending=[];let complete,scrollTimer;
      const first=new Promise(r=>{complete=r;scrollTimer=setTimeout(r,18000);});
      const onScrollResponse=response=>{
        const request=response.request();
        if(request.method()!=='POST'||!new URL(request.url()).pathname.endsWith('/4partner/find'))return;
        pending.push((async()=>{
          const requestBody=JSON.parse(request.postData()||'{}');
          const event={requested:requestBody.pagination?.size,page:requestBody.pagination?.page,http:response.status()};events.push(event);
          try{
            const decoded=decodeResponse(response.status(),response.headers(),await response.text());
            const data=decoded.data?.creator_profile_list?decoded.data:decoded;
            if(!Array.isArray(data.creator_profile_list))throw fail('RESPONSE');
            await retainRows(data.creator_profile_list);event.returned=data.creator_profile_list.length;
          }catch(error){event.errorCode=error.code||'RESPONSE';}
          finally{complete();}
        })());
      };
      page.on('response',onScrollResponse);
      try{
        await withActiveListPage(page,async()=>{
          await page.evaluate(()=>{
            const scroller=document.getElementById('submodule_layout_container_id')||[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+200&&['auto','scroll'].includes(getComputedStyle(n).overflowY));
            if(scroller){scroller.scrollTop=scroller.scrollHeight;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));}
          });
          await first;
          // Observe any already-triggered frontend fill requests; no second scroll.
          await new Promise(r=>setTimeout(r,3000));
        });
      }finally{clearTimeout(scrollTimer);page.off('response',onScrollResponse);await Promise.all(pending);}
      summary.scroll={requests:events.length,events,newUniqueRows:retainedIds.size-before,totalUniqueRows:retainedIds.size};
      console.log(JSON.stringify({phase:'scroll',...summary.scroll}));
      const failed=events.find(e=>e.errorCode);if(failed)throw fail(failed.errorCode);
      await new Promise(r=>setTimeout(r,15000));
    }
    summary.stage='descending-probe';
    summary.probe=await probeListCapacity({direction:'descending',sizes:summary.sizes,pagesPerSize:once?1:2,beforeRequest:gate,retainRows,
      readPage:async pagination=>{
        const started=Date.now();
        const response=await page.evaluate(async(url,body,mode)=>{
          if(mode.startsWith('xhr-once'))return new Promise((resolve,reject)=>{
            const xhr=new XMLHttpRequest();
            xhr.open('POST',url,true);xhr.withCredentials=true;xhr.timeout=20000;
            xhr.setRequestHeader('Content-Type','application/json');
            xhr.onload=()=>resolve({status:xhr.status,headers:{'bdturing-verify':xhr.getResponseHeader('bdturing-verify')||'','retry-after':xhr.getResponseHeader('retry-after')||''},body:xhr.responseText});
            xhr.onerror=()=>reject(new Error('NETWORK'));xhr.ontimeout=()=>reject(new Error('TIMEOUT'));xhr.onabort=()=>reject(new Error('STOPPED'));
            xhr.send(JSON.stringify(body));
          });
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
          try{const r=await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
            return {status:r.status,headers:{'bdturing-verify':r.headers.get('bdturing-verify')||'','retry-after':r.headers.get('retry-after')||''},body:await r.text()};
          }finally{clearTimeout(timer);}
        },observed.url,{...observed.body,pagination},mode);
        console.log(JSON.stringify({phase:'response',requested:pagination.size,page:pagination.page,http:response.status,challenge:!!response.headers['bdturing-verify'],elapsedMs:Date.now()-started}));
        const decoded=decodeResponse(response.status,response.headers,response.body);
        const data=decoded.data?.creator_profile_list?decoded.data:decoded;
        console.log(JSON.stringify({phase:'sample',requested:pagination.size,page:pagination.page,returned:data.creator_profile_list?.length,http:response.status,elapsedMs:Date.now()-started}));
        return {profiles:data.creator_profile_list,pagination:data.next_pagination};
      }});
    keepPage=['CHALLENGE','RATE_LIMIT','AUTH','QUOTA','MARKET_AUTH'].includes(summary.probe.stoppedReason);
  }catch(error){summary.errorCode=['BUSY','CHALLENGE','RATE_LIMIT','AUTH','QUOTA','MARKET_AUTH','TIMEOUT','SAVE','RESPONSE'].includes(error.code)?error.code:'PROBE_FAILED';keepPage=true;}
  finally{
    if(page&&listener)page.off('response',listener);
    if(page&&!keepPage)await page.close().catch(()=>{});
    if(db)await db.close();if(browser)await browser.disconnect();if(app)await app.disconnect();
    summary.diagnosticPageKept=!!page&&keepPage;
    summary.retainedUniqueCreators=retainedIds.size;
    console.log(JSON.stringify(summary));
  }
}
main().catch(()=>{console.error(JSON.stringify({errorCode:'SETUP'}));process.exitCode=1;});
