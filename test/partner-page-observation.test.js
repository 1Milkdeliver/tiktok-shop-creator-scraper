'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {buildPageObservationPatch}=require('../lib/partner-page-observation');
const {CreatorDatabase}=require('../lib/database');
function sample() {return {version:1,creatorId:'123',market:'MY',observedAt:'2026-09-08T12:00:00Z',sourceUrl:'https://partner.tiktokshop.com/affiliate-cmp/creator/detail?cid=123&search_key=must-not-store',period:'2026-08-07 – 2026-09-06 GMT+00:00',base:{handle:'fixture',follower_cnt:0,is_fast_growing:false},groups:{sales:{GMV:'RM10K+','成交件数':'3.83M'},cooperation:{'平均佣金率':'--'},allVideo:{'视频数':'1','平均视频播放量':'281','视频平均互动率':'0.71%'},productVideo:{'视频数':'0','平均视频播放量':'0','视频平均互动率':'0.59%'}},distributions:{follower_genders_v2:[{label:'男性',percent:'53.38%'}]},uncollected:['partner_trend_json']};}
test('page observations preserve scopes, ranges, missingness and source; never complete API checkpoints',()=>{
 const prior={handle:'fixture',partner_checkpoint_json:'{"sections":{"basic":"done"}}',partner_details_json:'{"sections":{"basic":{"saved":true}}}',partner_field_status:'{"basic":{"handle":"已获取"}}'};
 const {patch,safe}=buildPageObservationPatch(sample(),prior,'MY','123');
 assert.equal(patch.video_avg_view_cnt,'281');assert.equal(patch.ec_video_avg_view_cnt,'0');
 assert.equal(patch.follower_cnt,0);assert.equal(patch.is_fast_growing,false);assert.equal(patch.med_gmv_revenue,'RM10K+');
 assert.equal(patch.video_publish_cnt_30d,undefined);assert.equal(patch.med_commission_rate,undefined);
 assert.equal(patch.partner_checkpoint_json,undefined);assert.equal(patch.partner_profile_completed_at,undefined);
 assert.equal(patch.selection_region,undefined);assert.equal(patch.whatsapp,undefined);
 assert.ok(JSON.parse(patch.partner_details_json).sections.basic.saved);
 assert.equal(JSON.parse(patch.partner_field_status).basic.handle,'已获取');
 assert.equal(safe.groups.allVideo['视频数'],'1');assert.equal(safe.groups.productVideo['视频数'],'0');
 assert.doesNotMatch(JSON.stringify(safe),/must-not-store|search_key/);
 assert.match(patch.partner_profile_status,/部分完成/);
});
test('bad identities, source URLs and malformed existing JSON reject without writes',()=>{
 const previous={handle:'fixture'};
 for(const modified of [{creatorId:'456'},{market:'TH'},{base:{handle:'different'}},{sourceUrl:'https://example.test/?cid=123'},{observedAt:'bad'}])assert.throws(()=>buildPageObservationPatch({...sample(),...modified},previous,'MY','123'));
 assert.throws(()=>buildPageObservationPatch(sample(),{...previous,partner_details_json:'bad'},'MY','123'));
 const completed=buildPageObservationPatch(sample(),{...previous,partner_profile_completed_at:'done'},'MY','123');
 assert.equal(completed.patch.partner_profile_status,undefined);
});
test('real SQLite update and reopen keep contacts, other markets and empty legacy fields unchanged',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'page-observation-')),db=new CreatorDatabase(path.join(dir,'test.db'));await db.open();t.after(()=>db.close());
 await db.upsertCreators([{creator_oecuid:'123',handle:'fixture',whatsapp:'00123',line:'line-fixture','合作邮箱':'fixture@example.test',med_commission_rate:'12%'}],{region:'MY'});
 await db.upsertCreators([{creator_oecuid:'123',handle:'other-market'}],{region:'TH'});
 const old=await db.partnerProfileRaw('MY','123'),other=await db.partnerProfileRaw('TH','123');
 const {patch,displayPatch}=buildPageObservationPatch(sample(),old,'MY','123');
 assert.equal((await db.updatePartnerProfile('MY','123',patch)).saved,1);await db.close();await db.open();
 const readback=await db.partnerProfileRaw('MY','123');for(const [k,v]of Object.entries(displayPatch))assert.deepEqual(readback[k],v,k);
 assert.equal(readback.whatsapp,'00123');assert.equal(readback.line,'line-fixture');assert.equal(readback.med_commission_rate,'12%');
 assert.deepEqual(await db.partnerProfileRaw('TH','123'),other);assert.equal((await db.listCreators({})).total,2);
 const numericRow=await db.get('SELECT total_gmv,units_sold FROM creators WHERE region=? AND creator_id=?',['MY','123']);
 assert.equal(numericRow.total_gmv,null);assert.equal(numericRow.units_sold,null);
 assert.equal(readback.partner_profile_completed_at,undefined);
});
