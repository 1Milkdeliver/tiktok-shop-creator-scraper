'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {VerificationGate}=require('../lib/verification-gate');

test('verification never continues automatically and rejected checks keep the task waiting',async()=>{
  const gate=new VerificationGate();let resolved=false,allowed=false;
  const pending=gate.wait({region:'MY',check:async()=>allowed?{ok:true}:{ok:false,error:'仍有验证码'}}).then(()=>{resolved=true;});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(resolved,false);assert.equal(gate.snapshot().waiting,true);
  assert.equal((await gate.confirm()).ok,false);assert.equal(resolved,false);
  allowed=true;assert.equal((await gate.confirm()).ok,true);await pending;
  assert.equal(resolved,true);assert.equal(gate.snapshot().waiting,false);
});

test('Stop cancels waiting and duplicate Continue cannot replay a request',async()=>{
  const gate=new VerificationGate(),controller=new AbortController();let checks=0,release;
  const waiting=gate.wait({region:'MY',signal:controller.signal,check:()=>{checks++;return new Promise(r=>release=r);}});
  const checked=gate.confirm();assert.equal((await gate.confirm()).ok,false);
  const stopped=assert.rejects(waiting,{code:'STOPPED'});controller.abort();await stopped;
  release({ok:true});assert.equal((await checked).ok,false);
  assert.equal(checks,1);assert.equal(gate.snapshot().waiting,false);
});

test('actual IPC and UI expose a distinct manual Continue button while preserving the running task',()=>{
  const fs=require('fs'),path=require('path'),read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  assert.match(read('preload.js'),/confirmVerification:.*confirm-verification/);
  assert.match(read('main.js'),/ipcMain.handle\('confirm-verification'/);
  assert.match(read('index.html'),/id="btnConfirmVerification"/);
  assert.match(read('index.html'),/window.api.confirmVerification\(\)/);
  assert.match(read('index.html'),/verification\?\.waiting/);
});
