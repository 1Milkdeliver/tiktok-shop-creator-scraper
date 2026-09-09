'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {setTimeout:delay}=require('node:timers/promises');
const {CreatorDatabase}=require('../lib/database');
const contacts=require('../lib/partner-contacts');
const root=path.resolve(__dirname,'..');
async function until(check){const end=Date.now()+4000;while(!check()){assert.ok(Date.now()<end,'Fixture deadline exceeded');await delay(5);}}

test('real main hooks start contacts after first COMMIT, before onDone; late seller writes preserve contact fields',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-stream-fixture-'));
  const db=new CreatorDatabase(path.join(dir,'synthetic.db'));await db.open();t.after(()=>db.close());
  const config={enrichContacts:true,shopRegion:'MY'};config.databaseJobId=await db.createScrapeJob(config);
  const calls=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const client={resolvePartner:async()=>{},fetchContacts:async(_region,id)=>{
    assert.equal((await db.listCreators({region:'MY'})).total>=1,true);
    calls.push(id);await gate;
    return {whatsapp:'00123',line:'fixture-line','合作邮箱':'fixture@example.test',contact_status:'已获取',contact_checked_at:'2026-09-09T00:00:00Z'};
  }};
  const native=createRequire(path.join(root,'main.js'));
  const context={fixtureDb:db,fixtureClient:client,writeLog(){},recordHistory(){},appData:{},
    require:name=>name==='electron'?{}:name==='./lib/partner-contacts'?{...contacts,ContactJob:class extends contacts.ContactJob {constructor(){super({intervalMs:0});}}}:native(name)};
  vm.createContext(context);
  const source=fs.readFileSync(path.join(root,'main.js'),'utf8').split('// ---- app folders:')[0];
  vm.runInContext(source+'\ncreatorDb=fixtureDb;partnerContactClient=fixtureClient;',context);
  const runner=vm.runInContext('runner',context), job=vm.runInContext('contactJob',context);t.after(()=>job.stop());
  runner.running=true;runner._lastConfig=config;runner._currentJobId=config.databaseJobId;
  runner.onStart(config);
  const initial=await runner.onDataReady([{creator_oecuid:'101'}],config);
  assert.equal(initial.inserted,1);await until(()=>calls.length===1);
  assert.equal(job.state.producerOpen,true);
  const next=await runner.onDataReady([{creator_oecuid:'102'}],config);
  assert.equal(next.inserted,1);assert.equal(job.state.total,2);
  runner.running=false;runner.onDone({ok:true});
  assert.equal(job.state.producerOpen,false);assert.equal(job.state.running,true);
  release();await job.done;
  await runner.onDataReady([{creator_oecuid:'101',whatsapp:'',line:'stale','合作邮箱':''}],config);
  assert.deepEqual(calls,['101','102']);assert.equal(job.state.completed,2);
  const row=(await db.listCreators({region:'MY'})).rows.find(r=>r.creator_id==='101');
  assert.equal(row.whatsapp,'00123');assert.equal(row.line,'fixture-line');assert.equal(row.contact_email,'fixture@example.test');
});

test('task page does not announce full completion or enable Start while contacts are draining',async()=>{
  let payload={running:false,status:'done',result:{ok:true},contacts:{running:true,outcome:'running',completed:2,total:7}};
  const elements=new Map(),status=[],spins=[],buttons=[],results=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
  const context={uiLang:'zh',window:{api:{status:async()=>payload}},document:{getElementById:el},
    renderRateLimit(){},renderLibraryUpdateProgress(){},setStopButtonActive(){},lockOptions(){},
    syncMainButton:(mode,opts)=>buttons.push([mode,opts]),startSpin:text=>spins.push(text),stopSpin(){},
    setStatus:text=>status.push(text),showResult:value=>results.push(value),refreshAppData(){}};
  vm.createContext(context);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  vm.runInContext(html.slice(html.indexOf('async function poll()'),html.indexOf('function showResult(')),context);
  await context.poll();assert.equal(results.length,0);assert.equal(buttons.at(-1)[1].disabled,true);
  assert.match(spins.at(-1),/联系方式采集中/);assert.match(el('statusDetail').textContent,/2 \/ 7/);
  payload.contacts={running:false,outcome:'paused',completed:2,total:7};
  await context.poll();assert.match(status.at(-1),/联系方式待继续/);
  payload.contacts={running:false,outcome:'completed',completed:7,total:7};
  await context.poll();assert.equal(status.at(-1),'✅ 完成');assert.equal(buttons.at(-1)[1].disabled,false);
});
