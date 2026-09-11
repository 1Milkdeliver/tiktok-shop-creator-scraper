'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {blockDetailRecommendations} = require('../lib/partner-detail-network');

test('detail-only blocking targets recommendation find, never profile or contacts',async()=>{
  const events=[];
  const session={send:async(...args)=>events.push(args),detach:async()=>{}};
  const result=await blockDetailRecommendations({createCDPSession:async()=>session});
  assert.equal(result,session);
  assert.deepEqual(events,[['Network.enable'],['Network.setBlockedURLs',{
    urls:['*/api/v1/oec/affiliate/creator/marketplace/4partner/find*'],
  }]]);
});

test('a failed setup releases its diagnostic connection and propagates failure',async()=>{
  let detached=0;
  await assert.rejects(blockDetailRecommendations({createCDPSession:async()=>({
    send:async()=>{throw new Error('fixture');},detach:async()=>{detached++;},
  })}),/fixture/);
  assert.equal(detached,1);
});
