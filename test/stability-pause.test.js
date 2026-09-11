'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {pauseForStabilityRestriction}=require('../scripts/stability-pause');

test('stability restriction pauses without destroying the contact stream or closing the verification page',async()=>{
  const calls=[];
  const context={window:{api:{
    pause:async()=>{calls.push('pause');return {ok:true};},
    stopPartnerContacts:()=>{throw new Error('Must retain contact stream');},
    stop:()=>{throw new Error('Must retain task and verification page');},
  }}};
  const page={evaluate:fn=>vm.runInNewContext('('+fn.toString()+')()',context)};
  const result=await pauseForStabilityRestriction(page);
  assert.equal(result.ok,true);assert.deepEqual(calls,['pause']);
});
