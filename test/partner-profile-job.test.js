'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {CreatorDatabase}=require('../lib/database');
const {ContactJob,ContactError}=require('../lib/partner-contacts');
const {parseContacts}=require('../lib/contact-fields');
const {exportCsv,exportXlsx}=require('../lib/exporter');
const {FIELDS}=require('../lib/partner-profile-fields');

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'partner-full-test-'));
  const db=new CreatorDatabase(path.join(dir,'test.db')); await db.open(); t.after(()=>db.close());
  await db.upsertCreators([{creator_oecuid:'123',handle:'fixture-existing',follower_cnt:1000,med_gmv_revenue:40,'简介':'existing bio',last_publish_time:'2026-09-01',whatsapp:'001234',line:'keep-line',zalo:'keep-zalo',viber:'keep-viber','合作邮箱':'keep@example.test'}],{region:'MY'});
  await db.upsertCreators([{creator_oecuid:'123',handle:'other-market',follower_cnt:99}],{region:'TH'});
  const other=await db.partnerProfileRaw('TH','123');
  return {db,dir,other};
}
function clientFixture({fail}={}) {
  const calls=[];
  const client={resolvePartner:async()=>{},fetchProfileSection:async(region,id,types)=>{
    calls.push(types[0]); if (fail===types[0]) throw new ContactError('CHALLENGE','平台要求验证，已停止。');
    if (types[0]===4) return {creator_profile_trend_data:[{date:'2026-09-01',gmv:{value:42,currency:'MYR'}}]};
    const wrap=value=>({value,is_authorized:true});
    const groups={
      1:{creator_oecuid:id,handle:wrap('fixture-updated'),selection_region:wrap('MY'),category:wrap([{name:'Electronics'},{name:'Home'}]),bio:{value:'restricted',is_authorized:false},follower_cnt:wrap(0),is_fast_growing:wrap(false)},
      2:{med_gmv_revenue:wrap({format:'RM10K+'}),units_sold:wrap('0'),gpm:wrap({value:'1124',format:'RM11.24',currency:'MYR'}),future_metric:wrap({value:7,unit:'custom'})},
      3:{follower_ages_v2:wrap([{age:'25-34',percent:'51.2'}]),follower_genders_v2:wrap([{key:'Female',value:'51.2'}])},
      5:{top_video_data:wrap([{id:'9007199254740993',url:'https://example.test/video'}]),ec_top_video_data:wrap([])},
    };
    return {creator_profile:groups[types[0]],start_time:'100',end_time:'200'};
  },fetchContacts:async()=>{calls.push('contacts');return parseContacts([{field:1,value:'009876'},{field:31,value:'new-line'}]);}};
  return {client,calls};
}
async function run(db,client,options={}) {
  const job=new ContactJob({intervalMs:0});
  job.start({db,client,targets:['123'],region:'MY',mode:'full',...options});await job.done;return job;
}

test('all profile modules and contacts save, preserve original data, and export real-shaped nested fixtures',async t=>{
  const {db,dir,other}=await fixture(t),{client,calls}=clientFixture();
  const job=await run(db,client); assert.equal(job.state.errorCode,undefined);
  assert.equal(job.state.completed,1);assert.equal(job.state.sectionsSaved,6);
  assert.deepEqual(calls,[1,2,3,4,5,'contacts']);
  assert.deepEqual(await db.partnerProfileTargets({},'MY',true),[]);
  assert.deepEqual(await db.partnerProfileTargets({},'MY',false),['123']);
  const row=(await db.listCreators({region:'MY'})).rows[0];
  assert.equal(row.whatsapp,'009876');assert.equal(row.line,'new-line');assert.equal(row.zalo,'keep-zalo');
  assert.equal(row.contact_email,'keep@example.test');assert.equal(row.bio,'existing bio');
  assert.equal(row.follower_count,0);assert.equal(row.units_sold,0);assert.equal(row.total_gmv,null);
  assert.equal(row.med_gmv_revenue,'RM10K+');assert.equal(row.selection_region,'MY');assert.equal(row.partner_market,'MY');
  assert.equal(row.is_fast_growing,false);assert.match(row.category,/Electronics.*Home/);
  assert.match(row.top_video_data,/9007199254740993/);
  const details=JSON.parse(row.partner_details_json),status=JSON.parse(row.partner_field_status);
  assert.equal(details.sections.performance.profile.future_metric.value.unit,'custom');
  assert.equal(details.sections.performance.metadata.start_time,'100');
  assert.equal(status.basic.bio,'无权限');assert.equal(status.basic.last_publish_time,'未提供');
  assert.doesNotMatch(row.partner_details_json,/restricted/);
  assert.equal(JSON.parse(row.partner_trend_json)[0].gmv.currency,'MYR');
  assert.deepEqual(await db.partnerProfileRaw('TH','123'),other);
  assert.equal((await db.listCreators({})).total,2);
  const fields=['creator_oecuid','selection_region','whatsapp',...FIELDS.map(f=>f.k)];
  await exportCsv(path.join(dir,'full.csv'),[row],fields);
  assert.match(fs.readFileSync(path.join(dir,'full.csv'),'utf8'),/009876/);
  await exportXlsx(path.join(dir,'full.xlsx'),[row],fields);
  const book=new(require('exceljs').Workbook)();await book.xlsx.readFile(path.join(dir,'full.xlsx'));
  assert.equal(book.worksheets[0].getCell('C2').value,'009876');
  const col=fields.indexOf('partner_details_json')+1;
  assert.equal(JSON.parse(book.worksheets[0].getRow(2).getCell(col).value).sections.performance.metadata.end_time,'200');
});

test('challenge stops immediately, persists partial progress and resumes only missing modules',async t=>{
  const {db}=await fixture(t),first=clientFixture({fail:2});
  const failed=await run(db,first.client);
  assert.equal(failed.state.errorCode,'CHALLENGE');assert.equal(failed.state.completed,0);
  assert.deepEqual(first.calls,[1,2]);
  const partial=await db.partnerProfileRaw('MY','123');
  assert.equal(partial.partner_profile_completed_at,undefined);assert.match(partial.partner_profile_status,/未完成/);
  assert.ok(JSON.parse(partial.partner_checkpoint_json).sections.basic);
  assert.equal(JSON.parse(partial.partner_checkpoint_json).sections.performance,undefined);
  assert.equal(partial.whatsapp,'001234');
  const second=clientFixture(),resumed=await run(db,second.client);
  assert.equal(resumed.state.completed,1);assert.deepEqual(second.calls,[2,3,4,5,'contacts']);
  assert.doesNotMatch(JSON.stringify(resumed.snapshot()),/fixture-updated|009876|new-line|example.test/);
  const forced=clientFixture();await run(db,forced.client,{resume:false});
  assert.deepEqual(forced.calls,[1,2,3,4,5,'contacts']);
});

test('contact-only checks do not skip full enrichment; profile updates cannot overwrite contacts or insert records',async t=>{
  const {db}=await fixture(t);
  await db.updateCreatorContacts('MY','123',{contact_checked_at:new Date().toISOString()});
  assert.deepEqual(await db.contactTargets({},'MY',true),[]);
  assert.deepEqual(await db.partnerProfileTargets({},'MY',true),['123']);
  assert.deepEqual(await db.partnerProfileTargets({region:'TH'},'MY',false),[]);
  assert.deepEqual(await db.partnerProfileTargets({hasWhatsapp:true,hasEmail:true},'MY',false),['123']);
  await db.updatePartnerProfile('MY','123',{whatsapp:'bad',line:'bad',zalo:'bad',viber:'bad','合作邮箱':'bad',follower_cnt:2500,med_gmv_revenue:{value:'1245',format:'RM1.2K'}});
  const row=(await db.listCreators({region:'MY'})).rows[0];
  assert.equal(row.whatsapp,'001234');assert.equal(row.zalo,'keep-zalo');assert.equal(row.viber,'keep-viber');assert.equal(row.total_gmv,1245);assert.equal(row.follower_count,2500);
  assert.equal((await db.updatePartnerProfile('MY','999',{nickname:'should-not-insert'})).saved,0);
});

test('database write failure does not commit unsaved checkpoint or count creator complete',async t=>{
  const {db}=await fixture(t),{client,calls}=clientFixture();
  const original=db.updatePartnerProfile.bind(db);
  db.updatePartnerProfile=async(region,id,patch)=>{if (patch.gpm) throw new Error('private database detail'); return original(region,id,patch);};
  const job=await run(db,client);
  assert.equal(job.state.errorCode,'SAVE');assert.equal(job.state.completed,0);assert.deepEqual(calls,[1,2]);
  const row=await db.partnerProfileRaw('MY','123');
  assert.equal(JSON.parse(row.partner_checkpoint_json).sections.performance,undefined);
  assert.equal(row.partner_profile_completed_at,undefined);
  assert.doesNotMatch(JSON.stringify(job.snapshot()),/private database detail/);
});

test('Stop interrupts full-mode waiting and keeps successful module saved',async t=>{
  const {db}=await fixture(t),{client,calls}=clientFixture();
  const job=new ContactJob({intervalMs:10000}),original=db.updatePartnerProfile.bind(db);
  db.updatePartnerProfile=async(...args)=>{const result=await original(...args);if(args[2].handle)job.stop();return result;};
  const start=Date.now();job.start({db,client,targets:['123'],region:'MY',mode:'full'});await job.done;
  assert.equal(job.state.errorCode,'STOPPED');assert.equal(job.state.completed,0);assert.equal(job.state.sectionsSaved,1);
  assert.deepEqual(calls,[1]);assert.ok(Date.now()-start<2000);
  assert.ok(JSON.parse((await db.partnerProfileRaw('MY','123')).partner_checkpoint_json).sections.basic);
});
