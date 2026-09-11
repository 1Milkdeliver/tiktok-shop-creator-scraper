'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {launchRealWindow} = require('./browser');
const {toPuppeteerCookies} = require('./cookies');
const {codes} = require('./partner-markets');
const {ContactError,decodeResponse} = require('./partner-contacts');
const {blockDetailRecommendations} = require('./partner-detail-network');

const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const frontend = region => region === 'US' ? 'https://partner.us.tiktokshop.com' : 'https://partner.tiktokshop.com';

// Keep the official list's rendering/events active without raising its window.
// Scope this to list operations; always release it before detail/manual work ends.
async function withActiveListPage(page, operation) {
  const client = await page.createCDPSession();
  try {
    await client.send('Emulation.setFocusEmulationEnabled', {enabled:true});
    return await operation();
  } finally {
    await client.send('Emulation.setFocusEmulationEnabled', {enabled:false}).catch(()=>{});
    await client.detach().catch(()=>{});
  }
}

// Use the official search control's events, including while Chrome is minimized.
// The page constructs its own request; no dynamic request tokens are replayed.
async function submitCreatorSearch(page,query){
  const set=await page.evaluate(query=>{
    const input=[...document.querySelectorAll('input')].find(node=>node.getClientRects().length>0&&!node.disabled&&
      (node.type==='search'||/search|搜索/i.test((node.placeholder||'')+' '+(node.getAttribute('aria-label')||''))));
    if(!input)return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,query);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  },query);
  if(!set)throw new ContactError('SEARCH_UI','官方达人搜索框尚不可用，已保留搜索断点。');
  await sleep(500);
  const submitted=await page.evaluate(query=>{
    const input=[...document.querySelectorAll('input')].find(node=>node.getClientRects().length>0&&!node.disabled&&node.value===query&&
      (node.type==='search'||/search|搜索/i.test((node.placeholder||'')+' '+(node.getAttribute('aria-label')||''))));
    if(!input)return false;
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
    return true;
  },query);
  if(!submitted)throw new ContactError('SEARCH_UI','官方搜索框未保留目标关键词，未执行其他范围的抓取。');
}

function ensureRunning(signal,isStopped) {
  if (signal?.aborted || isStopped()) throw new ContactError('STOPPED','已停止，已获取的数据和断点均已保留。');
}
async function visibleState(page) {
  return page.evaluate(() => {
    const visible = selector => [...document.querySelectorAll(selector)].some(node => node.getClientRects().length > 0);
    return {login:visible('input[type="password"]') || /\/(?:login|sign-in)(?:\/|$)/i.test(location.pathname),
      challenge:visible('[id*="captcha"], [class*="captcha_verify"], iframe[src*="captcha"], iframe[title*="aptcha"]'),
      creatorPage:/查找达人|Find creators/i.test(document.body?.innerText || ''),bodyLength:document.body?.innerText?.length || 0};
  });
}
async function waitForManualVerification(page,{signal,isStopped=()=>false,onLog=()=>{},initial=false,loadTimeoutMs=60000,onManualRequired=async()=>{},onManualComplete=async()=>{}}={}) {
  let announced=false,surfaced=false;
  const loadDeadline=Date.now()+loadTimeoutMs;
  for (;;) {
    ensureRunning(signal,isStopped);
    if (page.isClosed?.()) throw new ContactError('STOPPED','采集浏览器已关闭，数据和断点均已保留。');
    const state=await visibleState(page);
    if (state.login) { await onManualRequired(page); throw new ContactError('AUTH','采集窗口需要重新登录，请登录后重新开始任务。'); }
    if (!state.challenge && (!initial || state.creatorPage || state.bodyLength>300)) { if(surfaced) await onManualComplete(page); return; }
    if(!state.challenge){
      if(Date.now()>=loadDeadline) throw new ContactError('TIMEOUT','Partner Center 页面尚未加载完成，未检测到可见验证码；已保留断点。');
      await sleep(250); continue;
    }
    if (!announced) { announced=true; surfaced=true; await onManualRequired(page); onLog('平台要求人工验证：请在弹出的 Partner Center 采集窗口完成验证；完成后任务将从当前请求自动继续。'); }
    await sleep(1000);
  }
}
async function surfaceManualVerification(page,{signal,isStopped=()=>false,onLog=()=>{},timeoutMs=15000,onManualRequired=async()=>{},onManualComplete=async()=>{}}={}) {
  // An API challenge can be returned before a visible captcha node exists.
  // Surface the official Partner Center window first, then refresh that same
  // page so TikTok can render its own verification control for the user.
  onLog('接口返回验证标记，正在检查官方页面是否出现可操作的验证码。');
  try { await page.reload({waitUntil:'domcontentloaded',timeout:60000}); }
  catch (_) { throw new ContactError('CHALLENGE','平台要求验证，但验证页面加载失败；已保留断点。'); }
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    ensureRunning(signal,isStopped);
    const state=await visibleState(page);
    if(state.login) { await onManualRequired(page); throw new ContactError('AUTH','采集窗口需要重新登录，请登录后重新开始任务。'); }
    if(state.challenge){
      await onManualRequired(page);
      // The challenge was already observed here. Keep the window visible until
      // a later poll confirms it has disappeared, then hide it exactly once.
      await waitForManualVerification(page,{signal,isStopped,onLog,onManualRequired,onManualComplete:async()=>{}});
      await onManualComplete(page);
      return true;
    }
    await sleep(Math.min(500,Math.max(1,deadline-Date.now())));
  }
  return false;
}
async function openPartnerBrowserSession(cookies,region,{signal,isStopped=()=>false,onLog=()=>{},launch=launchRealWindow,challengeSurfaceTimeoutMs=15000,findPageTimeoutMs=60000,onVerificationRequired}={}) {
  if (!Object.hasOwn(codes,region)) throw new ContactError('MARKET','暂未适配此团长市场。');
  ensureRunning(signal,isStopped);
  const opened=await launch(null,false,{background:true}),browser=opened.browser;
  let manualQueue=Promise.resolve();
  const onManualRequired=(page,requestSignal=signal)=>{
    const pending=manualQueue.then(async()=>{
    ensureRunning(requestSignal,isStopped);
    await opened.setWindowVisible?.(true,page);
    await page.bringToFront?.();
    if(onVerificationRequired){
      onLog('已暂停并保留采集页面：请手动验证，然后点击“我已完成验证，继续抓取”；不会自动关闭或继续。');
      await onVerificationRequired({region,signal:requestSignal,check:async()=>{
        if(page.isClosed?.())return {ok:false,error:'采集页面已关闭，请结束任务后从断点重新开始。'};
        const state=await visibleState(page);
        const target=new URL(page.url());
        if(target.origin!==frontend(region)||target.searchParams.get('market')!==String(codes[region]))
          return {ok:false,error:'当前页面不是任务目标市场 '+region+'，请回到原采集页面。'};
        if(state.login)return {ok:false,error:'页面仍要求登录，请先完成登录。'};
        if(state.challenge)return {ok:false,error:'页面仍显示验证码，请完成后再点继续。'};
        return {ok:true};
      }});
    }
    });
    manualQueue=pending.catch(()=>{});
    return pending;
  };
  const onManualComplete=page=>opened.setWindowVisible?.(false,page);
  const recoverManualVerification=async(target,requestSignal)=>{
    const state=await visibleState(target);
    if(onVerificationRequired){
      if(!state.challenge&&!state.login)await target.reload({waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
      await onManualRequired(target,requestSignal);
      ensureRunning(requestSignal,isStopped);
      return true;
    }
    if(!state.challenge) return surfaceManualVerification(target,
      {signal:requestSignal,isStopped,onLog,timeoutMs:challengeSurfaceTimeoutMs,onManualRequired,onManualComplete});
    await onManualRequired(target,requestSignal);
    await waitForManualVerification(target,
      {signal:requestSignal,isStopped,onLog,onManualRequired,onManualComplete:async()=>{}});
    await onManualComplete(target);
    return true;
  };
  let page,profilePage,closed=false,initialFind=null,resolveInitialFind,profileCapture=null,profileLoad=null,findManualWindowShown=false,activeQuery='';
  const findPages=[],findWaiters=[];
  const initialFindReady=new Promise(resolve=>{resolveInitialFind=resolve;});
  try {
    await browser.defaultBrowserContext().setCookie(...toPuppeteerCookies(cookies));
    page=await browser.newPage();
    page.on?.('response',async response=>{
      let requestBody={};
      try{
        const url=new URL(response.url());
        if(!url.pathname.endsWith('/4partner/find') || response.request?.().method?.()!=='POST') return;
        requestBody=JSON.parse(response.request?.().postData?.() || '{}');
        const text=await response.text(),data=decodeResponse(response.status(),response.headers?.() || {},text);
        if(!Array.isArray(data.creator_profile_list) || !data.next_pagination) return;
        const item={page:Number(requestBody.pagination?.page||0),query:String(requestBody.query||''),data};
        for(let index=findPages.length-1;index>=0;index--){
          if(findPages[index].challenge && findPages[index].page===item.page && findPages[index].query===item.query) findPages.splice(index,1);
        }
        if(item.page===0 && !item.query && !initialFind){initialFind=data;resolveInitialFind(data);}
        else findPages.push(item);
        while(findWaiters.length)findWaiters.shift()();
      }catch(error){
        const item={page:Number(requestBody.pagination?.page||0),query:String(requestBody.query||'')};
        // A passive page-response listener must not turn a platform challenge
        // into a terminal task error. Queue a recoverable signal so the normal
        // request path can surface the official verification page and retry.
        if(error instanceof ContactError && error.code==='CHALLENGE') item.challenge=true;
        else item.error=error instanceof ContactError ? error : new ContactError('RESPONSE','达人列表响应无法读取，已保留断点。');
        findPages.push(item);
        while(findWaiters.length)findWaiters.shift()();
      }
    });
    await page.goto(frontend(region)+'/affiliate-cmp/creator?market='+codes[region],{waitUntil:'domcontentloaded',timeout:60000});
    await waitForManualVerification(page,{signal,isStopped,onLog,initial:true,onManualRequired,onManualComplete});
  } catch(error) {
    await browser.close().catch(()=>{});
    throw error instanceof ContactError ? error : new ContactError('BROWSER','无法建立 Partner Center 页面会话，请检查浏览器和网络。');
  }
  const profileKey=types=>[...types].map(Number).sort((a,b)=>a-b).join(',');
  const wakeProfile=()=>{ for(const resolve of profileCapture?.waiters || []) resolve(); if(profileCapture) profileCapture.waiters=[]; };
  const ensureProfilePage=async()=>{
    if(profilePage && !profilePage.isClosed?.()) return profilePage;
    profilePage=await browser.newPage();
    // This page only supplies the current creator's details. Discovery has its
    // own page and must keep /4partner/find enabled for normal pagination.
    await blockDetailRecommendations(profilePage);
    profilePage.on?.('response',async response=>{
      const capture=profileCapture;
      try{
        const url=new URL(response.url()),request=response.request?.();
        if(!capture || response.status()!==200 || !url.pathname.endsWith('/4partner/profile') || request?.method?.()!=='POST') return;
        const payload=JSON.parse(request.postData?.() || '{}');
        if(String(payload.creator_oec_id)!==capture.creatorId || !Array.isArray(payload.profile_types)) return;
        const text=await response.text();
        capture.responses.set(profileKey(payload.profile_types),decodeResponse(response.status(),response.headers?.() || {},text));
        wakeProfile();
      }catch(error){
        if(capture===profileCapture){capture.error=error instanceof ContactError ? error : new ContactError('RESPONSE','详情页资料响应无法读取，已保留断点。');wakeProfile();}
      }
    });
    return profilePage;
  };
  const waitForProfile=async(capture,key,requestSignal,timeoutMs=60000)=>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      ensureRunning(requestSignal,isStopped);
      if(capture!==profileCapture) throw new ContactError('NETWORK','详情页会话已切换，已保留断点。');
      if(capture.error) throw capture.error;
      if(capture.responses.has(key)) return capture.responses.get(key);
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{capture.waiters=capture.waiters.filter(item=>item!==done);resolve();},250);
        const done=()=>{clearTimeout(timer);resolve();};
        capture.waiters.push(done);
      });
    }
    throw new ContactError('TIMEOUT','详情页未返回所需资料模块，已保留断点。');
  };
  const readProfileFromPage=async(url,body,requestSignal)=>{
    let parsed;
    try{parsed=JSON.parse(body||'{}');}catch(_){throw new ContactError('PROFILE_TYPE','资料请求结构无效。');}
    const creatorId=String(parsed.creator_oec_id||''),types=parsed.profile_types;
    if(!/^\d{1,30}$/.test(creatorId) || !Array.isArray(types) || !types.length) throw new ContactError('PROFILE_TYPE','资料请求结构无效。');
    const key=profileKey(types);
    const partnerId=String(url.searchParams.get('partner_id')||'');
    if(!/^\d{1,30}$/.test(partnerId)) throw new ContactError('CONTEXT','详情页缺少团长身份。');
    if(profileCapture?.creatorId===creatorId && profileCapture.responses.has(key)) return profileCapture.responses.get(key);
    if(profileCapture?.creatorId!==creatorId){
      const capture=profileCapture={creatorId,responses:new Map(),waiters:[],error:null};
      const detail=frontend(region)+'/affiliate-cmp/creator/detail?'+new URLSearchParams({
        cid:creatorId,pair_source:'author_recommend',enter_from:'creator_connect_page',req_id:'',pid:partnerId,
        query:'',market:String(codes[region]),partner_id:partnerId
      });
      profileLoad=(async()=>{
        const target=await ensureProfilePage();
        try{
          await target.goto(detail,{waitUntil:'domcontentloaded',timeout:60000});
          await waitForManualVerification(target,{signal:requestSignal,isStopped,onLog,onManualRequired,onManualComplete});
        }catch(error){
          capture.error=error instanceof ContactError ? error : new ContactError('BROWSER','无法打开达人详情页，已保留断点。');
          wakeProfile();
        }
      })();
    }
    await profileLoad;
    for(;;) try {
      return await waitForProfile(profileCapture,key,requestSignal);
    } catch(error) {
      if (!(error instanceof ContactError) || error.code!=='CHALLENGE') throw error;
      // Detail responses can signal verification after the initial DOM check.
      // Surface/check that same detail page before advising manual action.
      const capture=profileCapture;
      capture.error=null;
      const visible=await recoverManualVerification(profilePage,requestSignal);
      if(!visible) throw new ContactError('CHALLENGE','详情接口返回验证标记，但页面未显示可操作的验证码；已暂停并保留资料断点，不再自动刷新。');
      if(onVerificationRequired){
        // Exactly one refresh per explicit acknowledgement, on the same page.
        capture.error=null;capture.responses.clear();
        await profilePage.reload({waitUntil:'domcontentloaded',timeout:60000});
        continue;
      }
      onLog('详情页验证码当前已不再显示，正在确认资料接口是否恢复；尚未判定验证成功。');
      try {
        const result=await waitForProfile(capture,key,requestSignal);
        onLog('详情资料接口已恢复，继续当前达人。');
        return result;
      } catch(nextError) {
        if(nextError instanceof ContactError && nextError.code==='CHALLENGE')
          throw new ContactError('CHALLENGE','详情页验证码已不再显示，但资料接口仍要求验证；未确认验证成功，已暂停并保留断点。');
        throw nextError;
      }
    }
  };
  const readNextFindPage=async(parsed,requestSignal)=>{
    const wantedPage=Number(parsed.pagination?.page||0),wantedQuery=String(parsed.query||'');
    let deadline=Date.now()+findPageTimeoutMs, reenter=true;
    for(;;){
      ensureRunning(requestSignal,isStopped);
      const errorIndex=findPages.findIndex(item=>item.error && item.page===wantedPage && item.query===wantedQuery);
      if(errorIndex>=0) throw findPages.splice(errorIndex,1)[0].error;
      const index=findPages.findIndex(item=>item.data && item.page===wantedPage && item.query===wantedQuery);
      if(index>=0){
        const data=findPages.splice(index,1)[0].data;
        if(findManualWindowShown){
          findManualWindowShown=false;
          await onManualComplete(page);
          onLog('平台验证已通过，已从当前达人列表请求继续抓取。');
        }
        return data;
      }
      const challengeIndex=findPages.findIndex(item=>item.challenge && item.page===wantedPage && item.query===wantedQuery);
      if(challengeIndex>=0){
        findPages.splice(challengeIndex,1);
        findManualWindowShown=true;
        const visible=await recoverManualVerification(page,requestSignal);
        if(visible){findManualWindowShown=false;onLog('验证已完成，正在重试当前达人列表请求。');}
        else throw new ContactError('CHALLENGE','接口返回验证标记，但页面未显示可操作的验证码；已暂停并保留断点，不再自动刷新。');
        deadline=Date.now()+findPageTimeoutMs; reenter=true;
        if(wantedQuery)await submitCreatorSearch(page,wantedQuery);
        continue;
      }
      if(Date.now()>=deadline) throw new ContactError('PAGINATION_STALLED','达人列表翻页未推进：未收到目标页数据，已暂停并保留分页断点；不是已确认的网络故障。');
      await waitForManualVerification(page,{signal:requestSignal,isStopped,onLog,onManualRequired,onManualComplete});
      try{
        if(reenter){
          // Re-enter the bottom loading threshold, even if a previous attempt
          // left the list parked at its end while Chrome was minimized.
          await page.evaluate(()=>{
            const scroller=document.getElementById('submodule_layout_container_id') ||
              [...document.querySelectorAll('*')].find(node=>node.scrollHeight>node.clientHeight+200 && ['auto','scroll'].includes(getComputedStyle(node).overflowY));
            if(scroller) scroller.scrollTop=Math.max(0,scroller.scrollHeight-scroller.clientHeight-Math.max(600,scroller.clientHeight));
          });
          await sleep(100); reenter=false;
        }
        await page.evaluate(()=>{
          const scroller=document.getElementById('submodule_layout_container_id') ||
            [...document.querySelectorAll('*')].find(node=>node.scrollHeight>node.clientHeight+200 && ['auto','scroll'].includes(getComputedStyle(node).overflowY));
          if(!scroller) return false;
          scroller.scrollTop=scroller.scrollHeight;
          scroller.dispatchEvent(new Event('scroll',{bubbles:true}));
          return true;
        });
      }catch(_){throw new ContactError('NETWORK','达人列表页面已中断，已保留分页断点。');}
      await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);resolve();};
        const timer=setTimeout(()=>{const i=findWaiters.indexOf(done);if(i>=0)findWaiters.splice(i,1);resolve();},750);
        findWaiters.push(done);
      });
    }
  };
  const request=async(url,_headers,requestSignal,{method,body})=>{
    let manualWindowShown=false;
    for (;;) {
      ensureRunning(requestSignal,isStopped);
      if(method==='POST' && url.pathname.endsWith('/4partner/profile')) return readProfileFromPage(url,body,requestSignal);
      if(method==='POST' && url.pathname.endsWith('/4partner/find')){
        return withActiveListPage(page,async()=>{
        let parsed={}; try{parsed=JSON.parse(body||'{}');}catch(_){}
        const query=String(parsed.query||'');
        if(query!==activeQuery){
          findPages.length=0;initialFind=null;
          await submitCreatorSearch(page,query);
          activeQuery=query;
        }
        if(Number(parsed.pagination?.page||0)===0 && !String(parsed.query||'')){
          if(!initialFind) await Promise.race([initialFindReady,sleep(15000)]);
          if(initialFind){const result=initialFind;initialFind=null;return result;}
        }
        return readNextFindPage(parsed,requestSignal);
        });
      }
      await waitForManualVerification(page,{signal:requestSignal,isStopped,onLog,onManualRequired,onManualComplete});
      let response;
      try {
        let timeout;
        try { response=await Promise.race([page.evaluate(async(target,requestMethod,payload)=>{
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
          try {
            const result=await fetch(target,{method:requestMethod,headers:{Accept:'application/json','Content-Type':'application/json'},credentials:'include',body:payload,signal:controller.signal});
            return {status:result.status,headers:{'bdturing-verify':result.headers.get('bdturing-verify')||'','retry-after':result.headers.get('retry-after')||''},body:await result.text()};
          } finally { clearTimeout(timer); }
        },url.href,method,body),new Promise((_,reject)=>{ timeout=setTimeout(()=>reject(new ContactError('TIMEOUT','页面会话请求超时，已保留断点。')),45000); })]); }
        finally { clearTimeout(timeout); }
      } catch(error) {
        if (error instanceof ContactError) throw error;
        throw new ContactError('NETWORK','页面会话连接中断，已保留断点。');
      }
      try {
        const decoded=decodeResponse(response.status,response.headers,response.body);
        if(manualWindowShown){
          await onManualComplete(page);
          onLog('平台验证已通过，已从当前请求继续抓取。');
        }
        return decoded;
      }
      catch(error) {
        if (!(error instanceof ContactError) || error.code!=='CHALLENGE') throw error;
        manualWindowShown=true;
        const visible=await recoverManualVerification(page,requestSignal);
        if(visible) onLog('验证已完成，正在重试当前请求。');
        else throw new ContactError('CHALLENGE','接口返回验证标记，但页面未显示可操作的验证码；已暂停并保留断点，不再自动刷新。');
      }
    }
  };
  const close=async()=>{
    if (closed) return; closed=true;
    await browser.close().catch(()=>{});
    const resolved=path.resolve(opened.profileDir||''),temp=path.resolve(os.tmpdir())+path.sep;
    if (opened.profileDir && resolved.startsWith(temp) && path.basename(resolved).startsWith('tiktok-pack-profile-')) fs.rmSync(resolved,{recursive:true,force:true});
  };
  return {request,close,page,browser,region,profilePageDriven:true,
    requestManualVerification:requestSignal=>recoverManualVerification(page,requestSignal),
    refreshedCookies:()=>browser.defaultBrowserContext().cookies()};
}
module.exports={openPartnerBrowserSession,waitForManualVerification,surfaceManualVerification,visibleState,frontend,submitCreatorSearch,withActiveListPage};
