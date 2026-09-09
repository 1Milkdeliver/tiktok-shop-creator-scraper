'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {PartnerContactClient, ContactJob, ContactError, cookieHeader, decodeResponse} = require('../lib/partner-contacts');
const cookies = [{domain:'.tiktokshop.com',path:'/',name:'sessionid',value:'test-only'}];

test('cookies are domain/path/expiry bounded, header injection is rejected', () => {
  assert.equal(cookieHeader(cookies,'/api/test'), 'sessionid=test-only');
  assert.throws(() => cookieHeader([{...cookies[0],domain:'.com'}],'/'), /有效登录会话/);
  assert.throws(() => cookieHeader([{...cookies[0],domain:'affiliate.tiktokshop.com'}],'/'), /有效登录会话/);
  assert.throws(() => cookieHeader([{...cookies[0],expirationDate:1}],'/'), /有效登录会话/);
  assert.throws(() => cookieHeader([{...cookies[0],value:'bad\r\nInjected: value'}],'/'), /有效登录会话/);
  assert.equal(cookieHeader([...cookies,{...cookies[0],name:'private',path:'/partner',value:'x'}],'/api/test'), 'sessionid=test-only');
});

test('stops on quota, HTTP limits, challenges, redirects and malformed responses', () => {
  for (const [status,headers,body,code] of [
    [429,{},'','RATE_LIMIT'], [200,{'bdturing-verify':'test'},'','CHALLENGE'], [302,{},'','AUTH'], [403,{},'','AUTH'],
    [200,{},'{"code":16005003}','QUOTA'],[200,{},'{"code":16005005}','QUOTA'],[200,{},'{"code":10000}','AUTH'],
    [200,{},'{"code":16201010}','AUTH'],[200,{},'{"code":16201025}','AUTH'],[200,{},'<html>login</html>','RESPONSE'],
    [200,{},'{}','RESPONSE'],[200,{},'null','RESPONSE'],[200,{},'{"code":98001004,"message":"sensitive-value"}','API'],
  ]) assert.throws(() => decodeResponse(status,headers,body), e => e.code === code && !e.message.includes('sensitive-value'));
  assert.deepEqual(decodeResponse(200,{},'{"code":0,"data":{}}'), {code:0,data:{}});
});

test('selects TAP by market_region (not market_id), and requests contacts without visiting IM', async () => {
  const calls = [];
  const client = new PartnerContactClient(cookies, {request:async url => {
    calls.push(url);
    if (url.pathname.endsWith('/info')) return {code:0,data:{partner_biz_role_info:{market_list:[
      {market_id:6,market_region:5,type_list:[{type:4,partner_id:'999'}]},
      {market_id:1234,market_region:6,type_list:[{type:1,partner_id:'111'},{type:4,partner_id:'222'}]},
    ]}}};
    assert.equal(url.searchParams.get('partner_id'),'222'); assert.equal(url.searchParams.get('scene'),'11');
    return {code:0,data:{contact_info:[{field:1,value:'001234'},{field:31,value:'line-fixture'},{field:2,value:'test@example.com'}]}};
  }});
  const result = await client.fetchContacts('MY','123');
  assert.equal(result.whatsapp,'001234'); assert.equal(result.line,'line-fixture');
  await client.fetchContacts('MY','456');
  assert.equal(calls.filter(u => u.pathname.endsWith('/info')).length,1);
  assert.ok(calls.every(u => u.origin === 'https://partner.tiktokshop.com' && !u.pathname.includes('/im')));
  await assert.rejects(client.fetchContacts('DE','123'), {code:'MARKET'});
  await assert.rejects(client.fetchContacts('MY','123&bad'), {code:'CREATOR_ID'});
  await assert.rejects(client.fetchContacts('MY','123',AbortSignal.abort()), {code:'STOPPED'});
});

test('missing contact_info is an error, not a successful empty result', async () => {
  const client = new PartnerContactClient(cookies,{request:async () => ({code:0})}); client.contexts.set('MY','222');
  await assert.rejects(client.fetchContacts('MY','123'),{code:'RESPONSE'});
});

test('job saves incrementally, stops on quota without retry, and keeps logs redacted', async () => {
  let calls = 0; const saved = [];
  const job = new ContactJob({intervalMs:0});
  job.start({region:'MY',targets:['123','456','789'],client:{resolvePartner:async()=>{},fetchContacts:async()=>{
    calls++; if (calls===2) throw new ContactError('QUOTA','平台额度受限');
    return {whatsapp:'private-test-value',contact_status:'已获取'};
  }},db:{updateCreatorContacts:async (...args)=>{saved.push(args);return {saved:1};}}});
  assert.throws(()=>job.start({}),{code:'BUSY'});
  await job.done;
  assert.equal(calls,2); assert.equal(saved.length,1); assert.equal(job.state.completed,1); assert.equal(job.state.found,1); assert.equal(job.state.errorCode,'QUOTA');
  assert.equal(job.state.running,false); assert.doesNotMatch(JSON.stringify(job.snapshot()),/private-test-value|123|456|789/);
});

test('Stop interrupts interval immediately and successful empty results count separately', async () => {
  const job = new ContactJob(); let calls=0;
  const firstSaved = new Promise(resolve => {
    job.start({region:'MY',targets:['123','456'],client:{resolvePartner:async()=>{},fetchContacts:async()=>{calls++;return {contact_status:'未提供'};}},db:{updateCreatorContacts:async()=>{resolve();return {saved:1};}}});
  });
  await firstSaved; const start=Date.now(); job.stop(); await job.done;
  assert.equal(calls,1); assert.equal(job.state.completed,1); assert.equal(job.state.empty,1); assert.equal(job.state.found,0); assert.ok(Date.now()-start<1000);
});

test('DB failure is not counted as success or retried', async () => {
  const job = new ContactJob();
  job.start({region:'MY',targets:['123'],client:{resolvePartner:async()=>{},fetchContacts:async()=>({contact_status:'已获取'})},db:{updateCreatorContacts:async()=>{throw new Error('sensitive data');}}});
  await job.done; assert.equal(job.state.completed,0); assert.equal(job.state.errorCode,'SAVE'); assert.doesNotMatch(JSON.stringify(job.snapshot()),/sensitive data/);
});

test('job snapshots and deduplicates the full scope without accepting later mutations', async () => {
  const targets = ['123','456','123'], calls = [];
  const job = new ContactJob({intervalMs:0});
  job.start({region:'MY',targets,client:{resolvePartner:async()=>{},fetchContacts:async(_region,id)=>{
    calls.push(id); return {contact_status:'未提供'};
  }},db:{updateCreatorContacts:async()=>({saved:1})}});
  targets.splice(0, targets.length, '789');
  await job.done;
  assert.deepEqual(calls,['123','456']);
  assert.equal(job.state.total,2); assert.equal(job.state.completed,2);
  assert.equal(job.state.outcome,'completed');
  assert.throws(()=>job.start({targets:[123]}),{code:'CREATOR_ID'});
});

test('transient reads recover beyond a fixed retry count, without duplicate writes or skipping IDs', async () => {
  const failures = [new ContactError('NETWORK','private transport detail'),new ContactError('TIMEOUT','timeout'),
    ...[500,502,503,504,503,503].map(status => {
      try { decodeResponse(status,{},'private body'); } catch (error) { return error; }
    })];
  const job = new ContactJob({intervalMs:0,retryDelaysMs:[0]}), calls = [], saved = [];
  let contextCalls = 0;
  job.start({region:'MY',targets:['123','456'],client:{resolvePartner:async()=>{
    if (++contextCalls === 1) throw new ContactError('NETWORK','private context detail');
  },fetchContacts:async(_region,id)=>{
    calls.push(id);
    if (failures.length) throw failures.shift();
    return {contact_status:'已获取'};
  }},db:{updateCreatorContacts:async(_region,id)=>{saved.push(id);return {saved:1};}}});
  await job.done;
  assert.equal(contextCalls,2);
  assert.deepEqual(calls,[...Array(9).fill('123'),'456']);
  assert.deepEqual(saved,['123','456']);
  assert.equal(job.state.retryCount,9); assert.equal(job.state.retryAt,null);
  assert.equal(job.state.completed,2); assert.equal(job.state.outcome,'completed');
  assert.equal(job.state.errorCode,undefined);
  assert.doesNotMatch(JSON.stringify(job.snapshot()),/private/);
});

test('Stop cancels a long recovery wait immediately, without marking the creator checked', {timeout:3000}, async () => {
  const job = new ContactJob({retryDelaysMs:[300000]}); let calls = 0, writes = 0;
  const originalLog = job.log.bind(job);
  job.log = text => { originalLog(text); if (job.state.retryAt) queueMicrotask(()=>job.stop()); };
  const started = Date.now();
  job.start({region:'MY',targets:['123'],client:{resolvePartner:async()=>{},fetchContacts:async()=>{
    calls++; throw new ContactError('NETWORK','temporary');
  }},db:{updateCreatorContacts:async()=>{writes++;return {saved:1};}}});
  await job.done;
  assert.equal(calls,1); assert.equal(writes,0); assert.equal(job.state.completed,0);
  assert.equal(job.state.outcome,'stopped'); assert.equal(job.state.retryAt,null);
  assert.ok(Date.now()-started<1000);
});

test('actual throttling, auth, challenges and invalid data pause immediately without auto retry', async () => {
  for (const code of ['RATE_LIMIT','QUOTA','CHALLENGE','AUTH','COOKIE_MISSING','MARKET_AUTH','RESPONSE','API']) {
    const job = new ContactJob({intervalMs:0,retryDelaysMs:[0]}); let calls = 0, writes = 0;
    job.start({region:'MY',targets:['123','456'],client:{resolvePartner:async()=>{},fetchContacts:async()=>{
      calls++; throw new ContactError(code,'已暂停');
    }},db:{updateCreatorContacts:async()=>{writes++;return {saved:1};}}});
    await job.done;
    assert.equal(calls,1,code); assert.equal(writes,0,code);
    assert.equal(job.state.errorCode,code); assert.equal(job.state.retryCount,0);
    assert.equal(job.state.outcome,'paused'); assert.equal(job.state.completed,0);
  }
});

test('full-profile mode keeps its existing no-retry policy', async () => {
  const job = new ContactJob({retryDelaysMs:[0]}); let calls = 0;
  job.start({region:'MY',targets:['123'],mode:'full',client:{resolvePartner:async()=>{
    calls++; throw new ContactError('NETWORK','connection failed');
  }},db:{}});
  await job.done;
  assert.equal(calls,1); assert.equal(job.state.retryCount,0); assert.equal(job.state.outcome,'paused');
});
