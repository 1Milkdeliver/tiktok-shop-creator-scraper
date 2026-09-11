'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openPartnerBrowserSession,frontend}=require('../lib/partner-browser');

test('background list rendering is activated without showing the window and released on failure',async()=>{
  const {withActiveListPage}=require('../lib/partner-browser');
  for(const fails of [false,true]){
    const events=[];
    const page={createCDPSession:async()=>({send:async(method,args)=>events.push([method,args.enabled]),detach:async()=>events.push(['detach'])})};
    const result=withActiveListPage(page,async()=>{events.push(['operation']);if(fails)throw new Error('fixture');return 12;});
    if(fails)await assert.rejects(result,/fixture/);else assert.equal(await result,12);
    assert.deepEqual(events,[['Emulation.setFocusEmulationEnabled',true],['operation'],['Emulation.setFocusEmulationEnabled',false],['detach']]);
  }
});

test('a stalled list is a pagination error, not an indefinitely retried network timeout',async()=>{
  const f=fixture([],[]);
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
    {launch:f.launch,findPageTimeoutMs:0});
  await assert.rejects(session.request(new URL(frontend('MY')+'/api/4partner/find'),{},null,
    {method:'POST',body:JSON.stringify({pagination:{page:2}})}),{code:'PAGINATION_STALLED'});
  assert.equal(f.shown,0);
  await session.close();
});

test('page loading never announces a captcha; an invisible API challenge stops after one refresh',async()=>{
  const {waitForManualVerification}=require('../lib/partner-browser');
  const logs=[];
  await assert.rejects(waitForManualVerification({evaluate:async()=>({login:false,challenge:false,creatorPage:false,bodyLength:0})},
    {initial:true,loadTimeoutMs:0,onLog:message=>logs.push(message)}),{code:'TIMEOUT'});
  assert.deepEqual(logs,[]);
  const f=fixture([],[{status:200,headers:{'bdturing-verify':'1'},body:'{}'}]);
  let reloads=0;f.page.reload=async()=>{reloads++;};
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
    {launch:f.launch,challengeSurfaceTimeoutMs:1,onLog:message=>logs.push(message)});
  await assert.rejects(session.request(new URL(frontend('MY')+'/api/info'),{},null,{method:'GET'}),
    error=>error.code==='CHALLENGE'&&error.message.includes('未显示可操作'));
  assert.equal(reloads,1);assert.equal(f.responseCalls,1);assert.equal(f.shown,0);
  assert.ok(!logs.some(message=>message.includes('请在弹出')||message.includes('验证窗口已打开')));
  await session.close();
});

test('four background pages reactivate rendering and re-enter the loading threshold without showing a window',async()=>{
  const f=fixture([],[]),endpoint=frontend('MY')+'/api/4partner/find';
  const response=(query,page)=>({url:()=>endpoint,status:()=>200,headers:()=>({}),
    text:async()=>JSON.stringify({code:0,creator_profile_list:[{fixtureQuery:query}],next_pagination:{has_more:page===0,next_page:page+1}}),
    request:()=>({method:()=> 'POST',postData:()=>JSON.stringify({query,pagination:{page}})})});
  const evaluate=f.page.evaluate;let submissions=0,nextPage=1,active=false,reentered=false;
  f.page.createCDPSession=async()=>({send:async(_method,args)=>{active=args.enabled;},detach:async()=>{}});
  f.page.evaluate=async(fn,...args)=>{
    if(String(fn).includes('HTMLInputElement')){assert.equal(active,true);return true;}
    if(String(fn).includes('KeyboardEvent')){submissions++;await f.emit('response',response('unrelated',0));await f.emit('response',response(args[0],0));return true;}
    if(String(fn).includes('submodule_layout_container_id')){
      assert.equal(active,true);
      if(String(fn).includes('dispatchEvent')){
        assert.equal(reentered,true);reentered=false;
        await f.emit('response',response('phone case',nextPage++));
      }else reentered=true;
      return true;
    }
    return evaluate(fn,...args);
  };
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',{launch:f.launch});
  for(const page of [0,1,2,3]){
    const data=await session.request(new URL(endpoint),{},null,{method:'POST',body:JSON.stringify({query:'phone case',pagination:{page}})});
    assert.equal(data.creator_profile_list[0].fixtureQuery,'phone case');
    assert.equal(active,false,'detail work must not inherit list focus emulation');
  }
  assert.equal(submissions,1);assert.equal(f.responseCalls,0);
  assert.equal(f.shown,0);assert.equal(nextPage,4);
  await session.close();
});

function fixture(states,responses) {
  let responseCalls=0,closed=0,goto='',shown=0,hidden=0;const listeners={};
  const page={
    createCDPSession:async()=>({send:async()=>{},detach:async()=>{}}),
    isClosed:()=>false,
    goto:async url=>{goto=url;},
    reload:async()=>{},
    on:(name,handler)=>{(listeners[name] ||= []).push(handler);},
    evaluate:async (_fn,...args)=>{
      if (!args.length) return states.shift() || {login:false,challenge:false,creatorPage:true,bodyLength:500};
      return responses[responseCalls++];
    },
  };
  const browser={defaultBrowserContext:()=>({setCookie:async()=>{}}),newPage:async()=>page,close:async()=>{closed++;}};
  const emit=async(name,value)=>Promise.all((listeners[name]||[]).map(handler=>handler(value)));
  return {launch:async()=>({browser,profileDir:'',setWindowVisible:async visible=>{if(visible)shown++;else hidden++;}}),page,listeners,emit,
    get responseCalls(){return responseCalls;},get closed(){return closed;},get goto(){return goto;},get shown(){return shown;},get hidden(){return hidden;}};
}

test('page-session transport opens the selected market and returns decoded API data',async()=>{
  const f=fixture([{login:false,challenge:false,creatorPage:true,bodyLength:500},{login:false,challenge:false,creatorPage:true,bodyLength:500}],
    [{status:200,headers:{},body:'{"code":0,"data":{"ok":true}}'}]);
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',{launch:f.launch});
  assert.equal(session.profilePageDriven,true);
  const result=await session.request(new URL('https://partner.tiktokshop.com/api/v1/affiliate/partner/info'),{},null,{method:'GET'});
  assert.equal(result.data.ok,true); assert.equal(f.goto,frontend('MY')+'/affiliate-cmp/creator?market=6');
  await session.close(); assert.equal(f.closed,1);
});

test('visible platform verification pauses and then retries the same request',async()=>{
  const f=fixture([
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:true,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
  ],[
    {status:200,headers:{'bdturing-verify':'1'},body:'{"code":0}'},
    {status:200,headers:{},body:'{"code":0,"message":"success"}'},
  ]);
  const logs=[];
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',{launch:f.launch,onLog:m=>logs.push(m)});
  const result=await session.request(new URL('https://partner.tiktokshop.com/api/v1/affiliate/partner/info'),{},null,{method:'GET'});
  assert.equal(result.code,0); assert.equal(f.responseCalls,2);
  assert.ok(logs.some(message=>message.includes('验证已通过')));
  await session.close();
});

test('API-only verification refreshes the page so the official control can appear',async()=>{
  const f=fixture([
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:true,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
  ],[
    {status:200,headers:{'bdturing-verify':'1'},body:'{"code":0}'},
    {status:200,headers:{},body:'{"code":0,"message":"success"}'},
  ]);
  let reloads=0; f.page.reload=async()=>{reloads++;};
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
    {launch:f.launch,challengeSurfaceTimeoutMs:20});
  const result=await session.request(new URL('https://partner.tiktokshop.com/api/v1/affiliate/partner/info'),{},null,{method:'GET'});
  assert.equal(result.code,0); assert.equal(reloads,1); assert.equal(f.responseCalls,2);
  await session.close();
});

test('captured creator-list challenge is recoverable and resumes the same page after manual verification',async()=>{
  const f=fixture([
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:true,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
  ],[]),endpoint='https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/find';
  const response=(headers,body,page=1)=>({url:()=>endpoint,status:()=>200,headers:()=>headers,text:async()=>body,
    request:()=>({method:()=> 'POST',postData:()=>JSON.stringify({pagination:{size:12,page}})})});
  f.page.goto=async()=>{};
  const originalEvaluate=f.page.evaluate;let scrolled=0;
  f.page.evaluate=async(fn,...args)=>{
    if(String(fn).includes('submodule_layout_container_id')){
      if(!String(fn).includes('dispatchEvent')) return true;
      scrolled++;
      if(scrolled===1) await f.emit('response',response({'bdturing-verify':'1'},'{"code":0}'));
      else await f.emit('response',response({},JSON.stringify({code:0,creator_profile_list:[{creator_oecuid:{value:'2'}}],next_pagination:{has_more:false}})));
      return true;
    }
    return originalEvaluate(fn,...args);
  };
  const logs=[];
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
    {launch:f.launch,onLog:message=>logs.push(message),challengeSurfaceTimeoutMs:20,manualRetryDelayMs:1});
  const result=await session.request(new URL(endpoint),{},null,{method:'POST',body:'{"pagination":{"size":12,"page":1}}'});
  assert.equal(result.creator_profile_list[0].creator_oecuid.value,'2');
  assert.ok(f.shown>=1);assert.ok(f.hidden>=1);assert.ok(logs.some(message=>message.includes('验证已完成')));
  await session.close();
});

test('initial creator page response is reused without replaying dynamic signatures',async()=>{
  const f=fixture([{login:false,challenge:false,creatorPage:true,bodyLength:500}],[]);
  f.page.goto=async url=>{
    const body=JSON.stringify({code:0,creator_profile_list:[{creator_oecuid:{value:'1'}}],next_pagination:{has_more:true}});
    await f.emit('response',{url:()=> 'https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/find',status:()=>200,headers:()=>{},text:async()=>body,
      request:()=>({method:()=> 'POST',postData:()=>'{"pagination":{"size":12,"page":0}}'})});
  };
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',{launch:f.launch});
  const result=await session.request(new URL('https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/find'),{},null,
    {method:'POST',body:'{"pagination":{"size":12,"page":0},"filter_params":{},"algorithm":1}'});
  assert.equal(result.creator_profile_list.length,1); assert.equal(f.responseCalls,0);
  await session.close();
});

test('later discovery pages are loaded by scrolling the official list instead of replaying its request',async()=>{
  const f=fixture([{login:false,challenge:false,creatorPage:true,bodyLength:500}],[]),endpoint='https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/find';
  const response=(page,id,hasMore)=>({url:()=>endpoint,status:()=>200,headers:()=>{},
    text:async()=>JSON.stringify({code:0,creator_profile_list:[{creator_oecuid:{value:id}}],next_pagination:{has_more:hasMore,next_page:page+1}}),
    request:()=>({method:()=> 'POST',postData:()=>JSON.stringify({pagination:{size:12,page}})})});
  f.page.goto=async()=>f.emit('response',response(0,'1',true));
  const originalEvaluate=f.page.evaluate;let scrolled=0;
  f.page.evaluate=async(fn,...args)=>{
    if(String(fn).includes('submodule_layout_container_id')){if(String(fn).includes('dispatchEvent')){scrolled++;await f.emit('response',response(1,'2',false));}return true;}
    return originalEvaluate(fn,...args);
  };
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',{launch:f.launch});
  await session.request(new URL(endpoint),{},null,{method:'POST',body:'{"pagination":{"size":12,"page":0}}'});
  const result=await session.request(new URL(endpoint),{},null,{method:'POST',body:'{"pagination":{"size":12,"page":1}}'});
  assert.equal(result.creator_profile_list[0].creator_oecuid.value,'2');assert.equal(scrolled,1);assert.equal(f.responseCalls,0);
  await session.close();
});

test('profile modules are read from the detail page own responses without replaying signed requests',async()=>{
  const f=fixture([
    {login:false,challenge:false,creatorPage:true,bodyLength:500},
    {login:false,challenge:false,creatorPage:false,bodyLength:500},
  ],[]);
  const creatorId='9007199254740993123',partnerId='8650135177200502544';
  const networkCommands=[];
  f.page.createCDPSession=async()=>({send:async(...args)=>networkCommands.push(args),detach:async()=>{}});
  f.page.goto=async url=>{
    if(!url.includes('/detail?')) return;
    const body=JSON.stringify({code:0,creator_profile:{creator_oecuid:{value:creatorId}}});
    await f.emit('response',{
      url:()=> 'https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/profile?partner_id='+partnerId,
      status:()=>200,headers:()=>({}),text:async()=>body,
      request:()=>({method:()=> 'POST',postData:()=>JSON.stringify({creator_oec_id:creatorId,profile_types:[1,6]})}),
    });
  };
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',{launch:f.launch});
  assert.equal(networkCommands.length,0,'the main discovery page must not block find requests');
  const result=await session.request(new URL('https://api-partner-sg.tiktokshop.com/api/v1/oec/affiliate/creator/marketplace/4partner/profile?partner_id='+partnerId),{},null,
    {method:'POST',body:JSON.stringify({creator_oec_id:creatorId,profile_types:[1,6]})});
  assert.equal(result.creator_profile.creator_oecuid.value,creatorId);
  assert.equal(f.responseCalls,0);
  assert.deepEqual(networkCommands,[['Network.enable'],['Network.setBlockedURLs',{
    urls:['*/api/v1/oec/affiliate/creator/marketplace/4partner/find*'],
  }]]);
  await session.close();
});

test('late detail verification checks the same detail page once and never invents a visible captcha',async()=>{
  const clear={login:false,challenge:false,creatorPage:true,bodyLength:500};
  for(const visible of [false,true]){
    const f=fixture([clear,clear,clear,...(visible?[{...clear,challenge:true},clear]:[clear])],[]);
    const endpoint=frontend('MY')+'/api/4partner/profile?partner_id=123';
    const payload={creator_oec_id:'456',profile_types:[1,6]};
    const response=challenge=>({url:()=>endpoint,status:()=>200,headers:()=>challenge?{'bdturing-verify':'1'}:{},
      text:async()=>JSON.stringify({code:0,creator_profile:{creator_oecuid:{value:'456'}}}),
      request:()=>({method:()=> 'POST',postData:()=>JSON.stringify(payload)})});
    f.page.goto=async url=>{if(url.includes('/detail?'))await f.emit('response',response(true));};
    let reloads=0;
    f.page.reload=async()=>{reloads++;if(visible)await f.emit('response',response(false));};
    const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
      {launch:f.launch,challengeSurfaceTimeoutMs:1});
    const pending=session.request(new URL(endpoint),{},null,{method:'POST',body:JSON.stringify(payload)});
    if(visible){assert.equal((await pending).creator_profile.creator_oecuid.value,'456');assert.equal(f.shown,1);}
    else{await assert.rejects(pending,error=>error.code==='CHALLENGE'&&error.message.includes('详情接口')&&error.message.includes('未显示可操作'));assert.equal(f.shown,0);}
    assert.equal(reloads,1);await session.close();
  }
});

test('manual Continue keeps the detail page alive, rejects wrong market and retries only after acknowledgement',async()=>{
  const {VerificationGate}=require('../lib/verification-gate');
  const gate=new VerificationGate(),f=fixture([],[]);
  const endpoint=frontend('MY')+'/api/4partner/profile?partner_id=123';
  const payload={creator_oec_id:'456',profile_types:[1,6]};
  const response=challenge=>({url:()=>endpoint,status:()=>200,headers:()=>challenge?{'bdturing-verify':'1'}:{},
    text:async()=>JSON.stringify({code:0,creator_profile:{creator_oecuid:{value:'456'}}}),
    request:()=>({method:()=> 'POST',postData:()=>JSON.stringify(payload)})});
  let reloads=0,finished=false,market='5';
  f.page.url=()=>frontend('MY')+'/affiliate-cmp/creator/detail?market='+market;
  f.page.goto=async url=>{if(url.includes('/detail?'))await f.emit('response',response(true));};
  f.page.reload=async()=>{reloads++;await f.emit('response',response(reloads<2));};
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
    {launch:f.launch,onVerificationRequired:context=>gate.wait(context)});
  const pending=session.request(new URL(endpoint),{},null,{method:'POST',body:JSON.stringify(payload)}).then(value=>{finished=true;return value;});
  for(let i=0;i<30&&!gate.snapshot().waiting;i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(gate.snapshot().waiting,true);assert.equal(finished,false);assert.equal(f.closed,0);assert.equal(reloads,1);
  assert.equal((await gate.confirm()).ok,false);assert.equal(reloads,1);
  market='6';assert.equal((await gate.confirm()).ok,true);
  assert.equal((await pending).creator_profile.creator_oecuid.value,'456');
  assert.equal(reloads,2);assert.equal(f.closed,0);
  await session.close();assert.equal(f.closed,1);
});

test('stopping just the contact request releases its manual gate without stopping discovery',async()=>{
  const {VerificationGate}=require('../lib/verification-gate');
  const gate=new VerificationGate(),f=fixture([],[]),discovery=new AbortController(),contact=new AbortController();
  f.page.url=()=>frontend('MY')+'/affiliate-cmp/creator?market=6';
  const session=await openPartnerBrowserSession([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}],'MY',
    {launch:f.launch,signal:discovery.signal,onVerificationRequired:context=>gate.wait({...context,signal:context.signal||discovery.signal})});
  const pending=session.requestManualVerification(contact.signal).then(()=> 'resolved',error=>error.code);
  try{
    for(let i=0;i<30&&!gate.snapshot().waiting;i++)await new Promise(r=>setTimeout(r,1));
    assert.equal(gate.snapshot().waiting,true);
    contact.abort();
    const outcome=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('still waiting'),50))]);
    assert.equal(outcome,'STOPPED');
    assert.equal(gate.snapshot().waiting,false);assert.equal(discovery.signal.aborted,false);
  }finally{discovery.abort();await pending;await session.close();}
});
