'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {prepareSession, distributeWork, bounded} = require('../lib/session-startup');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
function fixture(states) {
  let opens = 0, closes = 0;
  const runner = {usedCookies:new Set(), stopped:false, log(){}, openSession:async()=>({browser:{close:async()=>closes++}})};
  const s = {index:0,cookieFile:'synthetic',creators:[],details:[]};
  const landing = async () => { const state = states[Math.min(opens++,states.length-1)];
    return {page:{close:async()=>{},evaluate:async()=>{if(state instanceof Error)throw state;return state;}}}; };
  return {runner,s,landing,counts:()=>({opens,closes})};
}
test('detached page gets one bounded recovery; blank page is not an invalid cookie', async()=>{
  const f = fixture([new Error('Attempted to use detached Frame'),{bodyLen:500}]);
  assert.equal(await prepareSession(f.runner,f.s,'auto',true,f.landing),true);
  assert.equal(f.counts().opens,2); assert.equal(f.s.startupState,'ready');
  const blank = fixture([{bodyLen:92}]);
  assert.equal(await prepareSession(blank.runner,blank.s,'auto',true,blank.landing),false);
  assert.equal(blank.counts().opens,2); assert.equal(blank.s.cookieInvalid,false);
});
test('login and verification are never retried', async()=>{
  for (const state of [{bodyLen:92,hasLogin:true},{bodyLen:800,challenge:true}]) {
    const f = fixture([state]);
    assert.equal(await prepareSession(f.runner,f.s,'auto',true,f.landing),false);
    assert.equal(f.counts().opens,1); assert.equal(f.counts().closes,1);
  }
});
test('all keywords are reassigned to ready accounts; first failed account cannot orphan detail workers',()=>{
  const ready=[{index:1},{index:2}], keywords=Array.from({length:128},(_,i)=>String(i));
  const plan=distributeWork(ready,keywords,true);
  const combined=[...plan.assignments.values()].flat();
  assert.equal(combined.length,128); assert.equal(new Set(combined).size,128);
  assert.deepEqual(distributeWork(ready,['one'],true).detailWorkers,[2]);
});
test('hung startup has a deadline and Stop is interruptible', async()=>{
  await assert.rejects(bounded(()=>new Promise(()=>{}),{timeoutMs:10}),{code:'STARTUP_TIMEOUT'});
  await assert.rejects(bounded(()=>new Promise(()=>{}),{isStopped:()=>true}),{code:'STOPPED'});
});
test('whole runner: all accounts fail -> error, cleanup and onDone, never successful zero rows',async()=>{
  const filename=path.resolve(__dirname,'../lib/multirunner.js'), native=createRequire(filename);
  const browser={setShopRegion(){},openLandingPage:async()=>({page:{evaluate:async()=>({bodyLen:92,hasLogin:true})}})};
  const context={module:{exports:{}},require:name=>name==='./browser'?browser:native(name),setTimeout,clearTimeout,setInterval,clearInterval,console};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
  const runner=new context.module.exports.MultiRunner();let done;
  runner.openSession=async()=>({browser:{close:async()=>{}}});runner.interruptibleSleep=async()=>{};
  runner.onDone=result=>done=result;
  await runner.start({discoverySource:'seller',cookieFiles:['fixture1','fixture2'],keywords:['one'],detail:false,mode:'auto',
    outPath:fs.mkdtempSync(path.join(os.tmpdir(),'startup-error-')),autoExport:false});
  assert.equal(runner.running,false);assert.equal(done.ok,false);assert.equal(runner.status,'error');
  assert.match(done.error,/没有可用/);assert.equal(done.invalidCookieIndexes.length,2);
  assert.ok(!runner.logs.some(line=>line.includes('抓取完成：0')));
});
