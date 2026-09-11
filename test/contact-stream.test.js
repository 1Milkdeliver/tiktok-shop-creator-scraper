'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {ContactJob,ContactError}=require('../lib/partner-contacts');
const {CollectionContacts,serializeCreatorWrites,contactDatabase}=require('../lib/collection-contacts');
const {CreatorDatabase}=require('../lib/database');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
async function until(check) {
  const end=Date.now()+4000;
  while(!check()) {assert.ok(Date.now()<end,'Fixture deadline exceeded');await delay(5);}
}
function fixture(t, options={}) {
  const calls=[],saves=[];
  const job=new ContactJob({intervalMs:0,...options});t.after(()=>job.stop());
  const client={resolvePartner:async()=>{},fetchContacts:async(_region,id)=>{calls.push({id,at:Date.now()});return {contact_status:'未提供'};}};
  const db={updateCreatorContacts:async(_region,id)=>{saves.push(id);return{saved:1};}};
  return {job,client,db,calls,saves};
}

test('empty streaming queue waits, late pages retain pacing, closing input drains and finishes exactly once',async t=>{
  const f=fixture(t,{intervalMs:100});
  f.job.startStream({...f,region:'MY'});
  await until(()=>f.job.state.waitingForCreators);
  assert.equal(f.calls.length,0);assert.equal(f.job.state.outcome,'running');
  assert.equal(f.job.append(['101','101']),1);
  await until(()=>f.job.state.completed===1 && f.job.state.waitingForCreators);
  assert.equal(f.job.state.running,true);
  assert.equal(f.job.append(['101','102']),1);
  f.job.closeInput();await f.job.done;
  assert.deepEqual(f.saves,['101','102']);
  assert.ok(f.calls[1].at-f.calls[0].at>=95,'interval must survive queue-empty and later append');
  assert.equal(f.job.state.outcome,'completed');assert.equal(f.job.state.producerOpen,false);
  assert.equal(f.job.append(['103']),0);
});

test('empty completed discovery uses no authorization/contact requests',async t=>{
  const f=fixture(t);let auth=0;f.client.resolvePartner=async()=>{auth++;};
  f.job.startStream({...f,region:'MY'});f.job.closeInput();await f.job.done;
  assert.equal(auth,0);assert.equal(f.job.state.outcome,'completed');assert.equal(f.job.state.total,0);
});

test('user pause holds contact reads; resume works, Stop while idle cannot be restarted by append',async t=>{
  const f=fixture(t);let paused=true;
  f.job.startStream({...f,region:'MY',isPaused:()=>paused});f.job.append(['101']);
  await until(()=>f.job.state.suspended);assert.equal(f.calls.length,0);
  paused=false;await until(()=>f.job.state.completed===1);
  f.job.stop();await f.job.done;
  assert.equal(f.job.state.outcome,'stopped');assert.equal(f.job.append(['102']),0);
  assert.equal(f.calls.length,1);
});

test('producer failure aborts idle consumer; producer completion cannot revive a stopped stream',async t=>{
  for(const result of [{ok:false},{ok:true,database:{error:'fixture failure'}}]) {
    const f=fixture(t);
    const pipeline=new CollectionContacts({config:{enrichContacts:true,databaseJobId:1,shopRegion:'MY'},...f});
    pipeline.finish(result);await f.job.done;
    assert.equal(f.job.state.outcome,'stopped');assert.equal(f.calls.length,0);
    pipeline.finish({ok:true});assert.equal(f.job.append(['101']),0);
  }
});

test('seller-internal cancellation blocks contact reads even without explicit IPC Stop',async t=>{
  const f=fixture(t);let canceled=false;
  f.job.startStream({...f,region:'MY',isCanceled:()=>canceled});
  canceled=true;f.job.append(['101']);await f.job.done;
  assert.equal(f.calls.length,0);assert.equal(f.job.state.outcome,'stopped');
});

test('Stop during in-flight write preserves the completed response and leaves next IDs untouched',async t=>{
  const f=fixture(t);let release,entered=false;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  f.db.updateCreatorContacts=async(_region,id)=>{entered=true;await gate;f.saves.push(id);return {saved:1};};
  f.job.startStream({...f,region:'MY'});f.job.append(['101','102']);
  await until(()=>entered);f.job.stop();release();await f.job.done;
  assert.deepEqual(f.saves,['101']);assert.equal(f.job.state.completed,1);
  assert.equal(f.job.state.total,2);assert.equal(f.job.state.outcome,'stopped');
});

test('actual auth and verification failures pause the stream; later pages never auto-retry',async t=>{
  for(const code of ['AUTH','CHALLENGE','QUOTA','RESPONSE']) {
    const f=fixture(t);let attempts=0;
    f.client.fetchContacts=async()=>{attempts++;throw new ContactError(code,'Fixture failure');};
    f.job.startStream({...f,region:'MY'});f.job.append(['101','102']);await f.job.done;
    assert.equal(f.job.state.errorCode,code);assert.equal(f.job.state.outcome,'paused');
    assert.equal(f.job.append(['103']),0);assert.equal(attempts,1);assert.equal(f.job.state.completed,0);
  }
});

test('stream rate limit cools down and retries the same creator',async t=>{
  const f=fixture(t);f.job.rateLimitDelaysMs=[0];let attempts=0;
  f.client.fetchContacts=async()=>{if(++attempts===1){const error=new ContactError('RATE_LIMIT','limited');error.retryAfterMs=0;throw error;}return {contact_status:'未提供'};};
  f.job.startStream({...f,region:'MY'});f.job.append(['101']);f.job.closeInput();await f.job.done;
  assert.equal(attempts,2);assert.deepEqual(f.saves,['101']);assert.equal(f.job.state.outcome,'completed');
});

test('shared write gate protects contact PATCH from concurrent seller transactions and stale detail flushes',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'contact-stream-db-'));
  const db=new CreatorDatabase(path.join(dir,'synthetic.db'));await db.open();t.after(()=>db.close());
  await db.upsertCreators([{creator_oecuid:'101',nickname:'before'}],{region:'MY'});
  const write=serializeCreatorWrites(operation=>operation()), adapter=contactDatabase(db,write);
  const originalGet=db.get.bind(db);let entered=false,release;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  db.get=async(...args)=>{
    const result=await originalGet(...args);
    if(args[0].startsWith('SELECT raw_json FROM creators') && !entered){entered=true;await gate;}
    return result;
  };
  const base=write(()=>db.upsertCreators([{creator_oecuid:'101',nickname:'after','合作邮箱':''}],{region:'MY',preserveContacts:true}));
  await until(()=>entered);
  const contact=adapter.updateCreatorContacts('MY','101',{whatsapp:'001234',line:'synthetic-line','合作邮箱':'fixture@example.test',contact_status:'已获取',contact_checked_at:'2026-09-09T00:00:00Z'});
  release();await Promise.all([base,contact]);
  // A later seller flush is allowed to carry an older or empty contact value.
  await write(()=>db.upsertCreators([{creator_oecuid:'101',nickname:'latest',whatsapp:'',line:'stale','合作邮箱':'old@example.test',contact_status:'待补全'}],{region:'MY',preserveContacts:true}));
  const row=(await db.listCreators({region:'MY'})).rows[0];
  assert.equal(row.nickname,'latest');assert.equal(row.whatsapp,'001234');assert.equal(row.line,'synthetic-line');
  assert.equal(row['合作邮箱'],'fixture@example.test');assert.equal(row.contact_email,'fixture@example.test');
  assert.equal(row.contact_status,'已获取');
  assert.deepEqual(await db.contactTargets({},'MY'),[]);
});
