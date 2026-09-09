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
