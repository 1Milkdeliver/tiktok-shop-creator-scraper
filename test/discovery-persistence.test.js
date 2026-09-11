'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const {createRequire} = require('node:module');
const {CreatorDatabase} = require('../lib/database');

function load(relative, mocks, timers = {}) {
  const filename = path.resolve(__dirname, relative), native = createRequire(filename);
  const context = {module:{exports:{}},require:name => mocks[name] || native(name),
    console:{log(){}},setTimeout,clearTimeout,setInterval,clearInterval,...timers};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), context, {filename});
  return context.module.exports;
}
const wireCreator = id => ({creator_oecuid:{value:id,is_authorized:true},handle:{value:'fixture-'+id,is_authorized:true},follower_cnt:{value:1200,is_authorized:true}});

test('every page persists creators before details, and failed writes replay from checkpoint', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'discovery-persist-'));
  const db = new CreatorDatabase(path.join(dir,'synthetic.db')); await db.open(); t.after(()=>db.close());
  const file = path.join(dir,'resume.json');
  let reads = 0;
  const api = load('../lib/scraper.js',{'./browser':{makeXhrFinder:()=>async()=>{
    reads++; return JSON.stringify({code:0,creator_profile_list:['101','102'].map(wireCreator),next_pagination:{has_more:false,next_page:1}});
  }}});
  const opts = {resumeState:file,onCreatorsDiscovered:async rows=>{
    await db.upsertCreators(rows,{region:'MY'});
    throw new Error('synthetic disk failure');
  },onNewCreators:()=>assert.fail('details must wait for persistence')};
  await assert.rejects(api.scrapeList({},['fixture'],opts),/synthetic disk failure/);
  assert.equal((await db.listCreators({})).total,2);
  assert.equal(JSON.parse(fs.readFileSync(file)).creators.length,2);
  const events = [];
  const resumed = await api.scrapeList({},['fixture'],{...opts,onCreatorsDiscovered:async rows=>{
    events.push(rows.length); await db.upsertCreators(rows,{region:'MY'});
  },onNewCreators:()=>assert.fail('replayed candidates must not be added twice')});
  assert.equal(resumed.creators.length,2); assert.deepEqual(events,[2]); assert.equal(reads,2);
  assert.equal((await db.listCreators({})).total,2);
  assert.equal((await db.contactTargets({},'MY')).length,2);
  await api.scrapeList({},['fixture'],{resumeState:file,onCreatorsDiscovered:async rows=>events.push(rows.length)});
  assert.deepEqual(events,[2,2]); assert.equal(reads,2); // completed checkpoint still hydrates storage
});

test('seller fast/full sessions save every discovered creator before any profile request; no 500-ID truncation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'seller-persist-'));
  const db = new CreatorDatabase(path.join(dir,'synthetic.db')); await db.open(); t.after(()=>db.close());
  const events = [];
  const browser = {makeXhrFinder:()=>async body=>{
    events.push('profile');
    assert.equal((await db.listCreators({region:'MY'})).total,2);
    return JSON.stringify({code:0,creator_profile:{handle:{value:'fixture-'+body.creator_oec_id}}});
  }};
  const scraper = load('../lib/scraper.js',{'./browser':browser});
  const {MultiRunner} = load('../lib/multirunner.js',{'./browser':browser,'./scraper':scraper});
  async function session(detail, ids, region) {
    const runner = new MultiRunner(); runner.running=true; runner.detailWorkers=[];
    runner.log=()=>{}; runner.interruptibleSleep=async()=>{};
    runner.onDataReady=async(rows,cfg)=>{events.push('save'); return db.upsertCreators(rows,{region:cfg.shopRegion});};
    const s={index:0,page:{},creators:[],details:[],sellerId:'fixture'}; runner.sessions=[s];
    await runner.runSession(s,[],detail,dir,false,false,ids,null,new Set(),new Set(),new Set(),false,'headless',true,{shopRegion:region});
    return {runner,s};
  }
  const full = await session(true,['100001','100002'],'MY');
  assert.deepEqual(events,['save','profile','profile']);
  assert.equal(full.s.details.length,2); assert.equal(full.runner.currentInfo.completed,2);
  assert.equal(full.runner.insertedThisRun,2);
  await full.runner.persistRows(full.s.creators,{shopRegion:'MY'});
  assert.equal(full.runner.insertedThisRun,2); // a final flush is not new discovery
  assert.equal((await db.listCreators({region:'MY'})).total,2);
  events.length=0;
  const ids=Array.from({length:501},(_,i)=>String(200000+i));
  const fast=await session(false,ids,'TH');
  assert.deepEqual(events,['save']); assert.equal(fast.s.creators.length,501);
  assert.equal((await db.listCreators({region:'TH'})).total,501);
});

test('sparse pages continue past 40 pages; unchanged pagination is incomplete rather than false success',async()=>{
  let page=0, saved=0;
  const api=load('../lib/scraper.js',{'./browser':{makeXhrFinder:()=>async()=>{
    page++; return JSON.stringify({code:0,creator_profile_list:[wireCreator(String(100000+page))],
      next_pagination:{has_more:page<43,next_page:page}});
  }}},{setTimeout:callback=>{queueMicrotask(callback);return 0;}});
  const result=await api.scrapeList({},['fixture'],{onCreatorsDiscovered:async rows=>{saved+=rows.length;}});
  assert.equal(page,43);assert.equal(saved,43);assert.equal(result.creators.length,43);
  const broken=load('../lib/scraper.js',{'./browser':{makeXhrFinder:()=>async()=>JSON.stringify({
    code:0,creator_profile_list:[wireCreator('100001')],next_pagination:{has_more:true,next_page:0}
  })}});
  const pending=await broken.scrapeList({},['fixture'],{});
  assert.equal(pending.incomplete,true);assert.equal(pending.creators.length,1);
});

test('seller persistence failure stops requests and retains discovered rows for final save', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'seller-save-failure-'));
  const browser={makeXhrFinder:()=>()=>assert.fail('no network after failed save')};
  const scraper=load('../lib/scraper.js',{'./browser':browser});
  const {MultiRunner}=load('../lib/multirunner.js',{'./browser':browser,'./scraper':scraper});
  const runner=new MultiRunner(); runner.running=true; runner.detailWorkers=[]; runner.log=()=>{};
  runner.onDataReady=async()=>{throw new Error('synthetic disk failure');};
  const s={index:0,page:{},creators:[],details:[]}; runner.sessions=[s];
  await runner.runSession(s,[],true,dir,false,false,['100001'],null,new Set(),new Set(),new Set(),true,'headless',true,{});
  assert.equal(runner.storageError,true); assert.equal(runner.stopped,true);
  assert.equal(s.creators.length,1); assert.equal(s.done,true);
});
