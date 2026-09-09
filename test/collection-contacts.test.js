'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {CreatorDatabase}=require('../lib/database');
const {ContactJob,ContactError}=require('../lib/partner-contacts');
const {parseContacts}=require('../lib/contact-fields');
const {startCollectionContacts,serializeCreatorWrites}=require('../lib/collection-contacts');

test('automatic handoff patches only this run in its market; empty and failed contacts keep all saved creators', async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collection-contacts-'));
  const db=new CreatorDatabase(path.join(dir,'synthetic.db')); await db.open(); t.after(()=>db.close());
  const config={enrichContacts:true,shopRegion:'MY'};
  config.databaseJobId=await db.createScrapeJob(config);
  const ids=['100001','100002','100003'];
  await db.upsertCreators(ids.map(id=>({creator_oecuid:id,handle:'fixture-'+id})),{region:'MY',jobId:config.databaseJobId});
  await db.upsertCreators([{creator_oecuid:'100004'}],{region:'MY'});
  await db.upsertCreators([{creator_oecuid:'100001'}],{region:'TH'});
  const calls=[];
  const client={resolvePartner:async region=>assert.equal(region,'MY'),fetchContacts:async(region,id)=>{
    calls.push(id);
    if(id==='100003')throw new ContactError('CHALLENGE','Synthetic challenge');
    return parseContacts(id==='100002'?[]:[{field:1,value:'001234'},{field:31,value:'fixture-line'},{field:2,value:'fixture@example.test'}]);
  }};
  const job=new ContactJob({intervalMs:0});
  const args={config,result:{ok:true,database:{saved:3}},db,client,job};
  const handoff=await startCollectionContacts(args); await job.done;
  assert.equal(handoff.outcome,'started'); assert.equal(handoff.total,3);
  assert.deepEqual(calls,ids); assert.equal(job.state.completed,2);
  assert.equal(job.state.errorCode,'CHALLENGE');
  const rows=(await db.listCreators({region:'MY'})).rows;
  const row=id=>rows.find(r=>r.creator_id===id);
  assert.equal(rows.length,4); assert.equal(row('100001').whatsapp,'001234');
  assert.equal(row('100002').contact_status,'未提供'); assert.match(row('100003').contact_status,/待补全/);
  assert.equal((await db.listCreators({})).total,5);
  await db.close(); await db.open();
  const resumed=new ContactJob({intervalMs:0});
  await startCollectionContacts({...args,job:resumed,client:{resolvePartner:async()=>{},fetchContacts:async(_region,id)=>{
    assert.equal(id,'100003'); return parseContacts([]);
  }}}); await resumed.done;
  assert.equal(resumed.state.total,1); assert.equal(resumed.state.completed,1);
  assert.deepEqual(await db.contactTargets({},'MY'),['100004']);
  assert.equal((await startCollectionContacts({...args,client:null})).outcome,'complete');
});

test('automatic stage needs explicit enable, successful storage, authorization, and never follows Stop or a connectivity test',async()=>{
  const config={enrichContacts:true,shopRegion:'MY',databaseJobId:99};
  let queried=0,started=0,canceled=false;
  const args={config,result:{ok:true},db:{contactTargets:async(...params)=>{
    assert.deepEqual(params,[{},'MY',true,99]); queried++; return ['123'];
  }},client:{},job:{start(){started++;}},isCanceled:()=>canceled};
  for(const override of [
    {config:{...config,enrichContacts:false}}, {config:{...config,enrichContacts:undefined}},
    {result:{ok:false}}, {result:{ok:true,testMode:true}}, {result:{ok:true,database:{error:'failed'}}},
    {config:{...config,databaseJobId:null}}, {db:null}, {isCanceled:()=>true},
  ]) await startCollectionContacts({...args,...override});
  assert.equal(started,0);assert.equal(queried,0);
  const missing=await startCollectionContacts({...args,client:null});
  assert.equal(missing.outcome,'needs_auth');assert.equal(missing.total,1);assert.equal(started,0);
  await startCollectionContacts({...args,db:{contactTargets:async()=>{canceled=true;return ['123'];}}});
  assert.equal(started,0);
});

test('parallel seller writes are serialized, keep all creators, and recover after a failed write',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'serialized-creators-'));
  const db=new CreatorDatabase(path.join(dir,'synthetic.db'));await db.open();t.after(()=>db.close());
  let active=0,max=0;
  const save=serializeCreatorWrites(async rows=>{
    active++;max=Math.max(max,active);
    try {if(rows===null)throw new Error('synthetic write failure');return await db.upsertCreators(rows,{region:'MY'});}
    finally {active--;}
  });
  const writes=Array.from({length:12},(_,i)=>save([{creator_oecuid:String(100000+i)}]));
  const failed=assert.rejects(save(null),/synthetic write failure/);
  const tail=save([{creator_oecuid:'999999'}]);
  await Promise.all([...writes,failed,tail]);
  assert.equal(max,1);assert.equal((await db.listCreators({})).total,13);
});

test('production UI/IPC wires the opt-in flag without exposing credentials, and packages the handoff',()=>{
  const root=path.resolve(__dirname,'..'), main=fs.readFileSync(path.join(root,'main.js'),'utf8'), html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(main,/enrichContacts: config\.enrichContacts === true/);
  assert.match(main,/runner\.onDataReady = serializeCreatorWrites/);
  assert.match(main,/finishCollectionContacts\(runner\._lastConfig, result\)/);
  assert.match(main,/isCanceled:.*runner\.stopped.*runner\.storageError.*contactPreparationVersion/);
  assert.match(main,/contactPreparationVersion\+\+; contactJob\.stop\(\)/);
  assert.match(html,/id="autoContacts" checked/); assert.match(html,/id="taskContactProgress"/);
  assert.match(html,/enrichContacts: document\.getElementById\('autoContacts'\)\.checked/);
  assert.match(html,/enrichContacts: last\?\.enrichContacts === true/);
  assert.doesNotMatch(html,/Max 500 per run|单次上限 500/);
  assert.ok(require('../package.json').build.files.includes('lib/**/*'));
});
