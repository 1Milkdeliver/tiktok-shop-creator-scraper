'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {MultiRunner}=require('../lib/multirunner');
const {ContactError,PartnerContactClient,MARKETS}=require('../lib/partner-contacts');
const {source}=require('../lib/account-cookies');
const {listRow}=require('../lib/partner-discovery');
const {backend}=require('../lib/partner-markets');
const wrap=value=>({is_authorized:true,value});
const profile=id=>({creator_oecuid:wrap(id),handle:wrap('fixture-'+id),follower_cnt:wrap(0),bio:{is_authorized:false,value:'restricted'}});
function setup(client,extra={}) {
  const runner=new MultiRunner(),rows=new Map();let done=0;
  runner.partnerCredential=client;runner.log=message=>runner.logs.push(message); runner.interruptibleSleep=async()=>{};
  runner.onDataReady=async batch=>{for(const row of batch) rows.set(row.creator_oecuid,{...(rows.get(row.creator_oecuid)||{}),...row});return {saved:batch.length,inserted:batch.length};};
  runner.onPartnerRaw=async(_region,id)=>rows.get(id);
  runner.onPartnerProfile=async(_region,id,patch)=>{rows.set(id,{...rows.get(id),...patch});return {saved:1};};
  runner.onDone=()=>done++;
  const config={cookieFiles:[],shopRegion:'MY',keywords:['fixture'],autoExport:false,partnerIntervalMs:0,
    outPath:fs.mkdtempSync(path.join(os.tmpdir(),'partner-discovery-test-')),...extra};
  return {runner,rows,config,done:()=>done};
}

test('discovery retains unmapped authorized fields without retaining restricted values or credentials',()=>{
  const row=listRow({...profile('1'),extra_metric:wrap({count:0,enabled:false}),
    authorization:'private-credential',nested:{cookies:'private-cookie'},
    protected_metric:{is_authorized:false,value:'private-restricted'}},'MY');
  const raw=JSON.parse(row.partner_discovery_json);
  assert.deepEqual(raw.extra_metric.value,{count:0,enabled:false});
  assert.equal(raw.protected_metric.is_authorized,false);
  assert.equal(raw.protected_metric.value,undefined);
  assert.equal(row.partner_discovery_json.includes('private-'),false);
  assert.equal(row.partner_discovery_json.includes('restricted'),false);
  assert.ok(require('../lib/partner-profile-fields').FIELDS.some(f=>f.k==='partner_discovery_json'));
});
test('all documented marketplace codes route to observed service domains, not import country',()=>{
  assert.deepEqual([MARKETS.TH,MARKETS.MY,MARKETS.VN,MARKETS.PH,MARKETS.SG,MARKETS.US],[5,6,7,10,13,100]);
  assert.equal(Object.keys(MARKETS).length,24);
  assert.equal(MARKETS.JP,20);assert.equal(MARKETS.BR,16);assert.equal(MARKETS.MX,19);
  for(const country of ['IT','ES','DE','FR','IE','PL','BE','NL','AT','CZ','GR','PT','HU']) assert.equal(backend(country),'https://partner.eu.tiktokshop.com');
  assert.equal(source(JSON.stringify([{name:'sessionid',value:'synthetic',domain:'.partner.us.tiktokshop.com'}])),'partner');
  assert.equal(source(JSON.stringify([{name:'sessionid',value:'synthetic',domain:'.tiktokshopglobalselling.com'}])),'seller');
  assert.equal(listRow(profile('1'),'MY').follower_cnt,0);assert.equal(listRow(profile('1'),'MY')['简介'],undefined);
});
test('US-labelled Partner export uses MY permission and MY find payload without forwarding US host-only secrets',async()=>{
  const calls=[];
  const client=new PartnerContactClient([{domain:'.tiktokshop.com',path:'/',name:'sessionid',value:'fixture-parent'},
    {domain:'.partner.us.tiktokshop.com',name:'hostOnly',value:'must-stay-us'}],{request:async(url,headers,_signal,options)=>{
    calls.push(url); assert.ok(!headers.Cookie.includes('must-stay-us'));
    if(url.pathname.endsWith('/info'))return {code:0,data:{partner_biz_role_info:{market_list:[{market_region:6,type_list:[{type:4,partner_id:'123'}]}]}}};
    assert.equal(url.origin,'https://api-partner-sg.tiktokshop.com');
    assert.equal(url.searchParams.get('partner_id'),'123');assert.equal(options.method,'POST');
    assert.deepEqual(JSON.parse(options.body),{query:'fixture',pagination:{size:12,page:0},filter_params:{},algorithm:1});
    return {code:0,creator_profile_list:[profile('1')],next_pagination:{has_more:false}};
  }});
  assert.equal((await client.findCreators('MY','fixture')).profiles.length,1);
  assert.equal(calls.length,2);
});
test('empty Partner discovery matches the current observed page contract',async()=>{
  const client=new PartnerContactClient([{domain:'.tiktokshop.com',path:'/',name:'sessionid',value:'fixture'}],{request:async(_url,_headers,_signal,options)=>{
    assert.deepEqual(JSON.parse(options.body),{pagination:{size:12,page:0},filter_params:{},algorithm:1});
    return {code:0,creator_profile_list:[profile('1')],next_pagination:{has_more:false}};
  }});
  client.resolvePartner=async()=> 'partner';
  assert.equal((await client.findCreators('MY','')).profiles.length,1);
});
test('Partner task skips seller browser, saves both populated and contact-empty creators, and follows pages',async()=>{
  let count=0,auth=0,startClient;
  const client={resolvePartner:async region=>{assert.equal(region,'MY');auth++;},findCreators:async()=>({profiles:[profile(String(++count))],pagination:count===1?{has_more:true,next_page:1,search_key:'fixture'}:{has_more:false}})};
  const s=setup(client);s.runner.openSession=()=>{throw new Error('must not open seller browser');};
  s.runner.onStart=()=>startClient=s.runner.activePartnerClient;
  await s.runner.start(s.config);
  assert.equal(s.runner.result.ok,true);assert.equal(auth,1);assert.equal(s.rows.size,2);assert.equal(startClient,client);
  assert.equal(s.runner.running,false);assert.equal(s.done(),1);assert.equal(s.runner.result.database.saved,2);
});
test('development sample stop drains as successful discovery without adding a product limit',async()=>{
  let page=0;
  const client={resolvePartner:async()=>{},findCreators:async()=>({
    profiles:Array.from({length:12},(_,i)=>profile(String(page*12+i+1))),
    pagination:{has_more:true,next_page:++page,search_key:'fixture'}
  })};
  const s=setup(client,{testStopAfter:20});
  await s.runner.start(s.config);
  assert.equal(s.runner.result.ok,true);
  assert.equal(s.runner.result.rows,20);
  assert.equal(s.runner.result.testStopReached,true);
  assert.equal(s.rows.size,20);
});
test('actual verification is not missing Cookie: stop once, never rotate, retain page checkpoint and saved rows',async()=>{
  let count=0;
  const client={resolvePartner:async()=>{},findCreators:async()=>{
    if(++count===2)throw new ContactError('CHALLENGE','平台要求验证');
    return {profiles:[profile('1')],pagination:{has_more:true,next_page:1,search_key:'fixture'}};
  }};
  const s=setup(client);await s.runner.start(s.config);
  assert.equal(s.runner.result.errorCode,'CHALLENGE');assert.equal(s.runner.running,false);assert.equal(count,2);assert.equal(s.rows.size,1);
  const checkpoints=fs.readdirSync(s.config.outPath);assert.equal(checkpoints.length,1);
  client.findCreators=async(_region,_query,pagination)=>{assert.equal(pagination.page,1);return {profiles:[profile('2')],pagination:{has_more:false}};};
  await s.runner.start(s.config);assert.equal(s.runner.result.ok,true);assert.equal(s.rows.size,2);assert.equal(fs.readdirSync(s.config.outPath).length,0);
});
test('full-detail interruption saves base and modules, then resumes without losing contacts or skipping unfinished creator',async()=>{
  let calls=[],fail=true;
  const client={resolvePartner:async()=>{},findCreators:async()=>({profiles:[profile('1')],pagination:{has_more:false}}),
    fetchProfileSection:async(_region,_id,types)=>{calls.push(types);if(fail&&types[0]===2)throw new ContactError('CHALLENGE','验证');
      return types[0]===4?{creator_profile_trend_data:[]}:{creator_profile:profile('1')};}};
  const s=setup(client,{detail:true,dedupe:true,existingIds:['1']});
  await s.runner.start(s.config);assert.equal(s.runner.result.ok,false);assert.ok(s.rows.get('1').partner_checkpoint_json);
  assert.equal(s.rows.get('1').partner_profile_completed_at,null);
  fail=false;calls=[];await s.runner.start(s.config);
  assert.equal(s.runner.result.ok,true);assert.ok(s.rows.get('1').partner_profile_completed_at);
  assert.ok(!calls.some(types=>types[0]===1));
});
test('page-driven detail capture paces once per creator while still saving all profile sections',async()=>{
  let sleeps=0,calls=0;
  const client={cookies:[],resolvePartner:async()=>{},findCreators:async()=>({profiles:[profile('1')],pagination:{has_more:false}}),
    fetchProfileSection:async(_region,_id,types)=>{calls++;return types[0]===4?{creator_profile_trend_data:[]}:{creator_profile:profile('1')};}};
  const s=setup(client,{detail:true,partnerIntervalMs:100,partnerBrowserFactory:async()=>({request:async()=>{},close:async()=>{},profilePageDriven:true})});
  s.runner.interruptibleSleep=async()=>{sleeps++;};
  await s.runner.start(s.config);
  assert.equal(s.runner.result.ok,true);assert.equal(calls,5);assert.equal(sleeps,2);
  assert.equal(s.runner.logs.filter(line=>line.includes('详情 1 条（MY · 已入库）')).length,1);
  assert.equal(s.runner.logs.some(line=>line.includes('团长资料：')),false);
  assert.ok(s.runner.logs.some(line=>line.includes('关键词「fixture」· 第 1 页：返回 1 位')));
  assert.ok(s.runner.logs.some(line=>line.includes('累计入库 1 位（新增 1 · 更新 0）')));
});
test('invalid ID, denied market and repeated cursor end as errors, not stuck running or successful empty tasks',async()=>{
  for(const [extra,client,code] of [
    [{creatorInput:['not-an-id']},{},'CREATOR_ID'],
    [{},{resolvePartner:async()=>{throw new ContactError('MARKET_AUTH','no access');}},'AUTH'],
    [{},{resolvePartner:async()=>{},findCreators:async()=>({profiles:[profile('1')],pagination:{has_more:true,next_page:0}})},'PAGINATION'],
  ]) {const s=setup(client,extra);await s.runner.start(s.config);assert.equal(s.runner.running,false);assert.equal(s.runner.result.errorCode,code);assert.equal(s.done(),1);}
});
test('missing credential files finalize the task and never leave the UI waiting for a result',async()=>{
  const s=setup(null,{cookieFiles:['missing-fixture-cookie.json']});
  await s.runner.start(s.config);
  assert.equal(s.runner.running,false);assert.equal(s.runner.result.ok,false);assert.equal(s.done(),1);
  assert.equal(s.runner.result.errorCode,'ENOENT');
});
test('Partner list 429 retries the same page after cooldown; challenge remains terminal',async()=>{
  let calls=0;
  const client={resolvePartner:async()=>{},findCreators:async()=>{
    if(++calls===1){const error=new ContactError('RATE_LIMIT','limited');error.retryAfterMs=0;throw error;}
    return {profiles:[profile('1')],pagination:{has_more:false}};
  }};
  const s=setup(client,{partnerRateLimitDelaysMs:[0]});await s.runner.start(s.config);
  assert.equal(s.runner.result.ok,true);assert.equal(calls,2);assert.equal(s.rows.size,1);
});

test('pagination stalls preserve the checkpoint and stop instead of entering the network retry loop',async()=>{
  let calls=0;
  const client={resolvePartner:async()=>{},findCreators:async()=>{
    calls++;
    if(calls===1)return {profiles:[profile('1')],pagination:{has_more:true,next_page:1}};
    throw new ContactError('PAGINATION_STALLED','分页未推进');
  }};
  const s=setup(client);await s.runner.start(s.config);
  assert.equal(calls,2);assert.equal(s.runner.running,false);
  assert.equal(s.runner.result.errorCode,'PAGINATION_STALLED');
  assert.equal(s.rows.size,1);assert.equal(fs.readdirSync(s.config.outPath).length,1);
  assert.ok(!s.runner.logs.some(line=>line.includes('网络暂时异常')));
});
