'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {CreatorDatabase}=require('../lib/database');
const {ContactJob,ContactError}=require('../lib/partner-contacts');
const {parseContacts}=require('../lib/contact-fields');
const {CollectionContacts,serializeCreatorWrites,contactDatabase}=require('../lib/collection-contacts');
const {setTimeout:delay}=require('node:timers/promises');
async function until(check) {
  const deadline=Date.now()+4000;
  while(!check()) {assert.ok(Date.now()<deadline,'Timed out waiting for fixture state');await delay(5);}
}

test('contacts start while discovery is open; concurrent rows are saved, deduped and scoped; errors never restart on new pages', async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collection-contacts-'));
  const db=new CreatorDatabase(path.join(dir,'synthetic.db')); await db.open(); t.after(()=>db.close());
  const config={enrichContacts:true,shopRegion:'MY'};
  config.databaseJobId=await db.createScrapeJob(config);
  const ids=['100001','100002','100003'];
  await db.upsertCreators([{creator_oecuid:'100004'}],{region:'MY'});
  await db.upsertCreators([{creator_oecuid:'100001'}],{region:'TH'});
  const calls=[];
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const client={resolvePartner:async region=>assert.equal(region,'MY'),fetchContacts:async(region,id)=>{
    calls.push(id);
    if(id==='100001') await blocked;
    if(id==='100003')throw new ContactError('CHALLENGE','Synthetic challenge');
    return parseContacts(id==='100002'?[]:[{field:1,value:'001234'},{field:31,value:'fixture-line'},{field:2,value:'fixture@example.test'}]);
  }};
  const job=new ContactJob({intervalMs:0});
  t.after(()=>{release();job.stop();});
  const write=serializeCreatorWrites(operation=>operation());
  const pipeline=new CollectionContacts({config,db:contactDatabase(db,write),client,job});
  const save=rows=>write(async()=>{
    const result=await db.upsertCreators(rows,{region:'MY',jobId:config.databaseJobId,preserveContacts:true});
    await pipeline.saved(rows,config);return result;
  });
  await until(()=>job.state.waitingForCreators);
  assert.equal(job.state.running,true);assert.equal(calls.length,0);
  await save([{creator_oecuid:ids[0]}]);
  await until(()=>calls.length===1);
  assert.equal(job.state.producerOpen,true,'first contact read must happen BEFORE discovery ends');
  await save(ids.map(id=>({creator_oecuid:id,handle:'fixture-'+id})));
  assert.equal((await db.listCreators({region:'MY'})).total,4,'network wait cannot block base inserts');
  assert.equal(job.state.total,3,'repeated base flush must not enqueue twice');
  release();await job.done;
  assert.deepEqual(calls,ids); assert.equal(job.state.completed,2);
  assert.equal(job.state.errorCode,'CHALLENGE');
  const rows=(await db.listCreators({region:'MY'})).rows;
  const row=id=>rows.find(r=>r.creator_id===id);
  assert.equal(rows.length,4); assert.equal(row('100001').whatsapp,'001234');
  assert.equal(row('100002').contact_status,'未提供'); assert.match(row('100003').contact_status,/待补全/);
  assert.equal((await db.listCreators({})).total,5);
  await save([{creator_oecuid:'100005'}]);
  await pipeline.saved([{creator_oecuid:'100004'}],{...config,databaseJobId:999});
  pipeline.finish({ok:true});
  assert.deepEqual(calls,ids,'new pages must not restart a challenged consumer');
  await db.close(); await db.open();
  const resumed=new ContactJob({intervalMs:0});
  const pending=await db.contactTargets({},'MY',true,config.databaseJobId);
  assert.deepEqual(pending,['100003','100005']);
  resumed.start({region:'MY',db,targets:pending,client:{resolvePartner:async()=>{},fetchContacts:async()=>parseContacts([])}}); await resumed.done;
  assert.equal(resumed.state.total,2); assert.equal(resumed.state.completed,2);
  assert.deepEqual(await db.contactTargets({},'MY'),['100004']);
});

test('streaming requires explicit enable, database job, authorization, and never starts for connectivity tests',async()=>{
  const config={enrichContacts:true,shopRegion:'MY',databaseJobId:99};
  let queried=0,started=0;
  const args={config,db:{contactTargets:async()=>{queried++;return ['123'];}},client:{},job:{startStream(){started++;}}};
  for(const override of [
    {config:{...config,enrichContacts:false}}, {config:{...config,enrichContacts:undefined}},
    {config:{...config,testMode:true}}, {config:{...config,databaseJobId:null}}, {db:null},
    {config:{...config,shopRegion:'XX'}},
  ]) new CollectionContacts({...args,...override});
  assert.equal(started,0);assert.equal(queried,0);
  const missing=new CollectionContacts({...args,client:null});
  await missing.saved([{creator_oecuid:'123'}],config);
  assert.equal(missing.outcome,'needs_auth');assert.equal(queried,0);
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

test('production UI/IPC wires streaming at start and committed saves, common write gate and combined stop/close',()=>{
  const root=path.resolve(__dirname,'..'), main=fs.readFileSync(path.join(root,'main.js'),'utf8'), html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(main,/enrichContacts: config\.enrichContacts === true/);
  assert.match(main,/runner\.onDataReady = \(rows, config\) => writeDatabase/);
  assert.match(main,/runner\.onStart = config =>/);
  assert.match(main,/collectionContacts\?\.saved\(rows, config\)/);
  assert.match(main,/collectionContacts\?\.finish\(result\)/);
  assert.match(main,/isCanceled:.*runner\.stopped.*runner\.storageError.*runner\.collectionIncomplete/);
  assert.match(main,/collectionContacts\?\.stop\(\); contactJob\.stop\(\); runner\.stop\(\)/);
  assert.match(main,/collectionContacts\?\.stop\(\); runner\.stop\(\)/);
  assert.match(main,/contactDatabase\(creatorDb, writeDatabase\)/);
  assert.doesNotMatch(main,/finishCollectionContacts|startCollectionContacts/);
  assert.match(main,/contactPreparationVersion\+\+; contactJob\.stop\(\)/);
  assert.match(html,/id="autoContacts" checked/); assert.match(html,/id="taskContactProgress"/);
  assert.match(html,/enrichContacts: document\.getElementById\('autoContacts'\)\.checked/);
  assert.match(html,/enrichContacts: last\?\.enrichContacts === true/);
  assert.doesNotMatch(html,/Max 500 per run|单次上限 500/);
  assert.ok(require('../package.json').build.files.includes('lib/**/*'));
});
