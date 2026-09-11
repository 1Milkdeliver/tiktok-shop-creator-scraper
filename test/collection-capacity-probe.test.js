'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {probeListCapacity}=require('../lib/collection-capacity-probe');
const rows=(start,n)=>Array.from({length:n},(_,i)=>({creator_oecuid:{value:String(start+i+1)},nickname:'private-fixture'}));
const base={retainRows:async()=>{},beforeRequest:async()=>{},sleep:async()=>{},intervalMs:0};
const response=(p,n=p.size)=>({profiles:rows(p.page*p.size,n),pagination:{has_more:true,next_page:p.page+1,search_key:'opaque',next_item_cursor:99}});

test('one-request approval does not paginate or claim verified capacity',async()=>{
  let saved=0;
  const r=await probeListCapacity({...base,sizes:[100],pagesPerSize:1,direction:'descending',retainRows:async rows=>{saved+=rows.length;},readPage:async p=>response(p)});
  assert.equal(r.requests,1);assert.equal(saved,100);assert.equal(r.largestVerifiedSize,null);
  assert.equal(r.samples[0].pages[0].returned,100);assert.equal(r.serverMaximumProven,false);
});

test('descending tests clamped sizes then verifies real capacity, never retries a challenge',async()=>{
  const calls=[];
  const r=await probeListCapacity({...base,direction:'descending',sizes:[100,50,24,12],readPage:async p=>{calls.push(p.size);return response(p,Math.min(p.size,12));}});
  assert.deepEqual(calls,[100,50,24,12,12]);assert.equal(r.largestVerifiedSize,12);
  assert.equal(r.serverMaximumProven,false);
  const blocked=await probeListCapacity({...base,direction:'descending',sizes:[100,50],readPage:async()=>{throw Object.assign(new Error('blocked'),{code:'CHALLENGE'});}});
  assert.equal(blocked.requests,1);assert.equal(blocked.samples.length,1);
  const full=await probeListCapacity({...base,direction:'descending',sizes:[100,50,12],readPage:async p=>response(p)});
  assert.equal(full.largestVerifiedSize,100);assert.equal(full.samples.every(s=>s.verified),true);
});
test('measures larger pages, retains every response, preserves cursors and makes no upper-bound claim',async()=>{
  let retained=0;const calls=[];
  const r=await probeListCapacity({...base,retainRows:async rs=>{retained+=rs.length;},readPage:async p=>{calls.push(p);return response(p);}});
  assert.equal(r.requests,6);assert.equal(retained,168);assert.equal(r.largestVerifiedSize,48);
  assert.equal(r.serverMaximumProven,false);assert.equal(calls[1].search_key,'opaque');assert.equal(calls[1].next_item_cursor,99);
  assert.equal(JSON.stringify(r).includes('private-fixture'),false);
});
test('server clamping stops escalation, rather than claiming requested size succeeded',async()=>{
  const r=await probeListCapacity({...base,readPage:async p=>response(p,12)});
  assert.equal(r.largestVerifiedSize,12);assert.equal(r.stoppedReason,'RETURNED_LESS_THAN_REQUESTED');assert.equal(r.requests,3);
});
test('verification and rate limits stop immediately, without retry or larger batch',async()=>{
  for(const code of ['CHALLENGE','RATE_LIMIT','AUTH','QUOTA']){
    const r=await probeListCapacity({...base,readPage:async()=>{throw Object.assign(new Error('secret'),{code});}});
    assert.equal(r.requests,1);assert.equal(r.stoppedReason,code);assert.equal(JSON.stringify(r).includes('secret'),false);
  }
});
test('waiting/manual gate blocks all API requests',async()=>{
  const r=await probeListCapacity({...base,beforeRequest:async()=>{throw Object.assign(new Error('waiting'),{code:'BUSY'});},readPage:async()=>assert.fail('must not request')});
  assert.equal(r.requests,0);assert.equal(r.stoppedReason,'BUSY');
});
test('duplicates, changed coverage and failed durable saves cannot verify a larger size',async()=>{
  const duplicate=await probeListCapacity({...base,readPage:async p=>({...response(p),profiles:rows(0,p.size)})});
  assert.equal(duplicate.stoppedReason,'DUPLICATE_PAGE');assert.equal(duplicate.largestVerifiedSize,null);
  const changed=await probeListCapacity({...base,readPage:async p=>({...response(p),profiles:rows((p.size===12?0:1000)+p.page*p.size,p.size)})});
  assert.equal(changed.stoppedReason,'COVERAGE_CHANGED');assert.equal(changed.largestVerifiedSize,12);
  const save=await probeListCapacity({...base,retainRows:async()=>{throw Object.assign(new Error('save'),{code:'SAVE'});},readPage:async p=>response(p)});
  assert.equal(save.stoppedReason,'SAVE');assert.equal(save.requests,1);
});
test('end of range and cancelled run are not mistaken for platform maximum',async()=>{
  const end=await probeListCapacity({...base,readPage:async()=>({profiles:rows(0,3),pagination:{has_more:false}})});
  assert.equal(end.stoppedReason,'RANGE_EXHAUSTED');assert.equal(end.largestVerifiedSize,null);
  const controller=new AbortController();controller.abort();
  const cancelled=await probeListCapacity({...base,signal:controller.signal,readPage:async()=>assert.fail('cancelled')});
  assert.equal(cancelled.requests,0);assert.equal(cancelled.stoppedReason,'STOPPED');
});
