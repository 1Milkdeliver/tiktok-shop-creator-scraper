'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {PartnerContactClient} = require('../lib/partner-contacts');
test('Partner profile uses observed POST contract, keeps IDs as strings and confines credentials', async () => {
  let call;
  const client = new PartnerContactClient([{domain:'.tiktokshop.com',name:'sessionid',value:'fixture'}], {request:async (...args) => { call=args; return {code:0,creator_profile:{}}; }});
  client.contexts.set('MY','123');
  await client.fetchProfileSection('MY','9007199254740993123',[1,6]);
  assert.equal(call[0].pathname,'/api/v1/oec/affiliate/creator/marketplace/4partner/profile');
  assert.equal(call[0].origin,'https://api-partner-sg.tiktokshop.com');
  assert.equal(call[0].searchParams.get('partner_id'),'123');
  assert.equal(call[3].method,'POST');
  assert.deepEqual(JSON.parse(call[3].body),{creator_oec_id:'9007199254740993123',profile_types:[1,6]});
  await assert.rejects(client.request('https://example.com/',{}),{code:'ORIGIN'});
  await assert.rejects(client.fetchProfileSection('MY','1',[9]),{code:'PROFILE_TYPE'});
  await assert.rejects(client.fetchProfileSection('MY',123,[1]),{code:'CREATOR_ID'});
});

const {SECTIONS,parseSection,exactNumeric}=require('../lib/partner-profile');
test('maps permitted fields, retains zero/false, and preserves every extended value and metric period',()=>{
  const result=parseSection({creator_profile:{creator_oecuid:{value:'123',is_authorized:true},handle:{value:'fixture',is_authorized:true},bio:{value:'blocked-value',is_authorized:false},follower_cnt:{value:0,is_authorized:true},is_fast_growing:{value:false,is_authorized:true},unknown_metric:{value:{amount:42,currency:'MYR'},is_authorized:true},nested:{x:{value:'blocked-nested',is_authorized:false}}},start_time:'100',end_time:'200'},SECTIONS[0],'123','MY');
  assert.equal(result.patch.follower_cnt,0); assert.equal(result.patch.is_fast_growing,false);
  assert.equal(result.patch['简介'],undefined); assert.equal(result.status.bio,'无权限');
  assert.equal(result.status.last_publish_time,'未提供');
  assert.equal(result.details.profile.unknown_metric.value.currency,'MYR');
  assert.equal(result.details.metadata.start_time,'100');
  assert.doesNotMatch(JSON.stringify(result),/blocked-value|blocked-nested/);
  assert.equal(result.patch.selection_region,undefined);
  assert.throws(()=>parseSection({creator_profile:{creator_oecuid:{value:'999'}}},SECTIONS[0],'123','MY'),{code:'PROFILE_ID'});
  assert.throws(()=>parseSection({creator_profile:{}},SECTIONS[0],'123','MY'),{code:'PROFILE_FORMAT'});
  assert.throws(()=>parseSection({creator_profile:{handle:{value:'fixture'}}},SECTIONS[0],'123','MY'),{code:'PROFILE_ID'});
  assert.throws(()=>parseSection({},SECTIONS[3],'123','MY'),{code:'PROFILE_FORMAT'});
  assert.equal(parseSection({creator_profile_trend_data:[]},SECTIONS[3],'123','MY').patch.partner_trend_json,'[]');
});
test('money/ranges are not silently promoted to exact amounts',()=>{
  assert.equal(exactNumeric({value:'12345',format:'RM12.3K'}),12345);
  for(const v of ['RM10K+','1.3M','1-10',{minimal:1,maximum:10},{format:'RM10K+'},NaN]) assert.equal(exactNumeric(v),null);
  assert.equal(exactNumeric('0'),0);
});
